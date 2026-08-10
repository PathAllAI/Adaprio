import type { CandidateMemory, DatabaseAdapter, EntityKey, MetadataSearchParams, VectorSearchParams } from '@adaprio/shared-types';
import type { MemoryRow } from '../types/db.js';

export class MemoryRepository {
  constructor(private readonly db: DatabaseAdapter) {}

  /**
   * The active, CONFIRMED record for this entity_key, if any. This is the
   * row conflict Rules 1/3/4 (Ch 06.2) act against — it deliberately
   * excludes an active TENTATIVE record (Rule 2's parallel record), since
   * a tentative memory never displaces or gets displaced by these rules.
   *
   * Implemented via `metadataSearch` with a generous limit and a
   * client-side filter for `certainty === 'confirmed'`, rather than a new
   * adapter method — `entity_key_registry.allows_multiple = false` for
   * every entity_key this matters for, so there are at most a handful of
   * candidate rows (one confirmed + a small number of tentative) to filter
   * through in practice.
   */
  async activeMemoryFor(params: { tenantId: string; userId: string; entityKey: EntityKey }): Promise<CandidateMemory | null> {
    const results = await this.db.metadataSearch({
      tenantId: params.tenantId,
      userId: params.userId,
      entityKey: params.entityKey,
      lifecycleFilter: ['active'],
      limit: 10,
    });
    return results.find((r) => r.certainty === 'confirmed') ?? null;
  }

  /**
   * Conflict Rule 2 — Tentative/Future State (Ch 06.2). Inserts a new,
   * independent row with `certainty = 'tentative'`. Does NOT touch any
   * existing active confirmed row for the same entity_key.
   *
   * ⚠️ PROPOSED REUSE, not explicit in migration 007: this calls the same
   * `apply_multi_value_insert` function that governance-repository.ts uses
   * for genuinely multi-value entities. That function is, mechanically,
   * just "insert an independent row" — it works here because
   * `enforce_single_active_per_entity` (migration 006) only rejects a
   * duplicate active row when `NEW.certainty = 'confirmed'`; a tentative
   * insert never trips that check regardless of which function performs
   * it. The two repository methods exist separately (rather than one
   * shared method) because they represent different business intents at
   * the call site, even though today they resolve to the same SQL.
   * Confirm this reuse is acceptable, or request a dedicated
   * `insert_tentative` function in migration 007 for clarity, before
   * relying on it in production.
   */
  async insertTentative(params: {
    tenantId: string;
    userId: string;
    entityKey: EntityKey;
    value: string;
    memoryText: string;
    embedding: number[] | null;
  }): Promise<MemoryRow> {
    return this.db.rpc<MemoryRow>('apply_multi_value_insert', {
      p_tenant_id: params.tenantId,
      p_user_id: params.userId,
      p_entity_key: params.entityKey,
      p_value: params.value,
      p_memory_text: params.memoryText,
      p_certainty: 'tentative',
      p_embedding: params.embedding,
    });
  }

  /**
   * Ownership check — confirms `memoryId` actually belongs to
   * `(tenantId, userId)` before accepting anything keyed by it from outside
   * (currently: routes/feedback.ts). Without this, migration 013's FK
   * constraint only proves the id exists SOMEWHERE, not that the requesting
   * tenant owns it — a gap worth closing given feedback is customer-
   * submitted input referencing another table's primary key.
   */
  async findById(params: { tenantId: string; userId: string; memoryId: string }): Promise<CandidateMemory | null> {
    const rows = await this.db.select<Record<string, unknown>>({
      table: 'memories',
      filters: { id: params.memoryId, tenant_id: params.tenantId, user_id: params.userId },
      limit: 1,
    });
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id as string,
      entityKey: row.entity_key as CandidateMemory['entityKey'],
      value: row.value as string,
      memoryText: row.memory_text as string,
      certainty: row.certainty as string,
      importanceScore: parseFloat(row.importance_score as string),
      lifecycleState: row.lifecycle_state as CandidateMemory['lifecycleState'],
      validFrom: row.last_confirmed_at as string,
      validUntil: row.valid_until as string | null,
      retrievalCount: row.retrieval_count as number,
      lastAccessed: row.last_accessed as string | null,
      reinforcementScore: parseFloat(String(row.reinforcement_score)),
    };
  }

  /** Thin passthrough — Ch 07.3. Kept here so `src/pipeline/read.ts` depends on the repository layer uniformly, never the adapter directly. */
  async vectorSearch(params: VectorSearchParams): Promise<CandidateMemory[]> {
    return this.db.vectorSearch(params);
  }

  /** Thin passthrough — used for category-filtered current-state lookups without a query vector (e.g. AMM3004 degraded fallback). */
  async metadataSearch(params: MetadataSearchParams): Promise<CandidateMemory[]> {
    return this.db.metadataSearch(params);
  }

  /**
   * Fire-and-forget reinforcement update (Ch 6.4). Kept as a repository
   * passthrough — same rationale as vectorSearch/metadataSearch above —
   * so src/pipeline/read.ts never calls the DatabaseAdapter directly.
   * Callers should not `await` this on the response-critical path; catch
   * and log failures without surfacing them to the caller.
   */
  async reinforceRetrieved(memoryIds: string[]): Promise<void> {
    return this.db.updateReinforcement(memoryIds);
  }

  /**
   * Embedding-backfill cron support (Ch 04.8, 05.5) — finds rows with
   * `embedding IS NULL`. Backed by `find_missing_embeddings` (migration
   * 016, proposed) rather than the generic `select()` primitive, since
   * "IS NULL" needs a different Supabase query-builder method (`.is()`)
   * than the `.eq()` every other `select()` caller uses.
   */
  async findMissingEmbeddings(limit: number): Promise<Array<{ id: string; memoryText: string }>> {
    const rows = await this.db.rpc<Array<{ id: string; memory_text: string }>>('find_missing_embeddings', {
      p_limit: limit,
    });
    return rows.map((r) => ({ id: r.id, memoryText: r.memory_text }));
  }

  /** Targeted single-column update — the write half of the embedding-backfill cron. */
  async updateEmbedding(id: string, embedding: number[]): Promise<void> {
    await this.db.update({ table: 'memories', filters: { id }, values: { embedding } });
  }
}
