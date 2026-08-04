import type { CandidateMemory, DatabaseAdapter, MetadataSearchParams, VectorSearchParams } from '@adaprio/shared-types';

/**
 * Test-only adapter (Ch 19.2: "the MockDatabaseAdapter used in unit tests
 * treats each repository method as a single async call and does not
 * attempt to simulate FOR UPDATE locking"). This class honors that
 * explicitly — it is single-threaded/synchronous-per-call by construction
 * (JS has no real concurrency within one microtask queue), so it cannot
 * and does not simulate the race conditions the real `FOR UPDATE SKIP
 * LOCKED` / optimistic-locking behavior guards against. Use it for
 * pipeline-wiring and governance-logic tests, never for concurrency tests
 * — those need a real Postgres instance (Ch 19.2, integration tests).
 *
 * Simulates the five governance functions from migration 007 plus the
 * two proposed pending-queue functions (migration 010) in-memory. Generic
 * `select`/`insert`/`update` operate on a simple in-memory table map.
 */
export class MockDatabaseAdapter implements DatabaseAdapter {
  private memories = new Map<string, Record<string, unknown>>();
  private tables = new Map<string, Map<string, Record<string, unknown>>>();
  private idCounter = 0;

  private nextId(): string {
    this.idCounter += 1;
    return `mock-${this.idCounter}`;
  }

  private table(name: string): Map<string, Record<string, unknown>> {
    if (!this.tables.has(name)) this.tables.set(name, new Map());
    return this.tables.get(name)!;
  }

  async rpc<T>(functionName: string, params: Record<string, unknown>): Promise<T> {
    switch (functionName) {
      case 'apply_direct_replacement':
        return this.applyDirectReplacement(params) as T;
      case 'apply_departure':
        return this.applyDeparture(params) as T;
      case 'apply_correction':
        return this.applyCorrection(params) as T;
      case 'apply_multi_value_insert':
        return this.applyMultiValueInsert(params) as T;
      case 'reinforce_batch':
        return this.reinforceBatch(params) as T;
      case 'claim_pending_batch':
        return this.claimPendingBatch(params) as T;
      case 'mark_pending_failed':
        return this.markPendingFailed(params) as T;
      case 'search_memories':
        return this.searchMemories(params) as T;
      default:
        throw new Error(`MockDatabaseAdapter: unimplemented rpc function "${functionName}"`);
    }
  }

  // ── Governance functions (migration 007) ─────────────────────────────

  private applyDirectReplacement(p: Record<string, unknown>): Record<string, unknown> {
    const existing = this.findActive(p.p_tenant_id, p.p_user_id, p.p_entity_key, 'confirmed');
    if (existing) {
      existing.lifecycle_state = 'superseded';
      existing.valid_until = new Date().toISOString();
    }
    const row = this.newMemoryRow(p, existing?.id as string | undefined);
    this.memories.set(row.id as string, row);
    if (existing) existing.superseded_by = row.id;
    return row;
  }

  private applyDeparture(p: Record<string, unknown>): null {
    const existing = this.findActive(p.p_tenant_id, p.p_user_id, p.p_entity_key, 'confirmed');
    if (existing) {
      existing.lifecycle_state = 'historical';
      existing.is_negation = true;
      existing.valid_until = new Date().toISOString();
    }
    return null;
  }

  private applyCorrection(p: Record<string, unknown>): number {
    const pattern = String(p.p_value_pattern).toLowerCase();
    let affected = 0;
    for (const row of this.memories.values()) {
      if (
        row.tenant_id === p.p_tenant_id &&
        row.user_id === p.p_user_id &&
        row.entity_key === p.p_entity_key &&
        ['active', 'historical', 'superseded'].includes(row.lifecycle_state as string) &&
        String(row.value).toLowerCase().includes(pattern)
      ) {
        row.lifecycle_state = 'deleted';
        row.is_correction = true;
        affected++;
      }
    }
    return affected;
  }

  private applyMultiValueInsert(p: Record<string, unknown>): Record<string, unknown> {
    const row = this.newMemoryRow(p, undefined);
    this.memories.set(row.id as string, row);
    return row;
  }

  private reinforceBatch(p: Record<string, unknown>): null {
    const ids = p.p_memory_ids as string[];
    for (const id of ids) {
      const row = this.memories.get(id);
      if (!row) continue;
      row.retrieval_count = (row.retrieval_count as number) + 1;
      row.last_accessed = new Date().toISOString();
      row.reinforcement_score = Math.min(1, (row.reinforcement_score as number) + 0.05);
    }
    return null;
  }

  private claimPendingBatch(p: Record<string, unknown>): Record<string, unknown>[] {
    const limit = p.p_limit as number;
    const pending = this.table('pending_memory_events');
    const claimed: Record<string, unknown>[] = [];
    for (const row of pending.values()) {
      if (claimed.length >= limit) break;
      if (row.status === 'pending') {
        row.status = 'processing';
        claimed.push(row);
      }
    }
    return claimed;
  }

  private markPendingFailed(p: Record<string, unknown>): Record<string, unknown> {
    const pending = this.table('pending_memory_events');
    const row = pending.get(p.p_id as string);
    if (!row) throw new Error(`MockDatabaseAdapter: no pending_memory_events row with id ${p.p_id}`);
    row.attempts = (row.attempts as number) + 1;
    row.last_error = p.p_error;
    row.status = (row.attempts as number) >= (row.max_attempts as number) ? 'failed' : 'pending';
    return row;
  }

  private searchMemories(p: Record<string, unknown>): Record<string, unknown>[] {
    const lifecycleFilter = p.p_lifecycle_filter as string[];
    const categoryFilter = p.p_category_filter as string[] | null;
    const entityKey = p.p_entity_key as string | null;
    const limit = p.p_limit as number;

    let rows = [...this.memories.values()].filter(
      (r) =>
        r.tenant_id === p.p_tenant_id &&
        r.user_id === p.p_user_id &&
        lifecycleFilter.includes(r.lifecycle_state as string) &&
        (!categoryFilter || categoryFilter.includes(r.category as string)) &&
        (!entityKey || r.entity_key === entityKey)
    );

    rows = rows
      .sort((a, b) => new Date(b.valid_from as string).getTime() - new Date(a.valid_from as string).getTime())
      .slice(0, limit);

    return rows.map((r) => ({ ...r, similarity_score: p.p_query_vector ? 0.5 : null }));
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private findActive(tenantId: unknown, userId: unknown, entityKey: unknown, certainty: string) {
    for (const row of this.memories.values()) {
      if (
        row.tenant_id === tenantId &&
        row.user_id === userId &&
        row.entity_key === entityKey &&
        row.lifecycle_state === 'active' &&
        row.certainty === certainty
      ) {
        return row;
      }
    }
    return undefined;
  }

  private newMemoryRow(p: Record<string, unknown>, previousVersionId: string | undefined): Record<string, unknown> {
    return {
      id: this.nextId(),
      tenant_id: p.p_tenant_id,
      user_id: p.p_user_id,
      entity_key: p.p_entity_key,
      category: (p.p_entity_key as string)?.split('.')[0] ?? null,
      value: p.p_value,
      memory_text: p.p_memory_text,
      certainty: p.p_certainty,
      lifecycle_state: 'active',
      is_negation: false,
      is_correction: false,
      archive_reason: null,
      previous_version_id: previousVersionId ?? null,
      superseded_by: null,
      version: 1,
      confidence: '1.000',
      importance_score: '0.500',
      reinforcement_score: 0,
      retrieval_count: 0,
      ttl_policy: null,
      expires_at: null,
      valid_until: null,
      last_accessed: null,
      valid_from: new Date().toISOString(),
      last_confirmed_at: new Date().toISOString(),
      embedding: p.p_embedding ?? null,
      lock_version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  // ── DatabaseAdapter interface — read/write primitives ──────────────────

  async vectorSearch(params: VectorSearchParams): Promise<CandidateMemory[]> {
    const rows = this.searchMemories({
      p_tenant_id: params.tenantId,
      p_user_id: params.userId,
      p_lifecycle_filter: params.lifecycleFilter,
      p_limit: params.limit,
      p_query_vector: params.queryVector,
      p_category_filter: params.categoryFilter ?? null,
      p_entity_key: null,
    });
    return rows.map((r) => this.toCandidateMemory(r));
  }

  async metadataSearch(params: MetadataSearchParams): Promise<CandidateMemory[]> {
    const rows = this.searchMemories({
      p_tenant_id: params.tenantId,
      p_user_id: params.userId,
      p_lifecycle_filter: params.lifecycleFilter,
      p_limit: params.limit,
      p_query_vector: null,
      p_category_filter: params.categoryFilter ?? null,
      p_entity_key: params.entityKey ?? null,
    });
    return rows.map((r) => this.toCandidateMemory(r));
  }

  private toCandidateMemory(row: Record<string, unknown>): CandidateMemory {
    return {
      id: row.id as string,
      entityKey: row.entity_key as CandidateMemory['entityKey'],
      value: row.value as string,
      memoryText: row.memory_text as string,
      certainty: row.certainty as string,
      importanceScore: parseFloat(row.importance_score as string),
      lifecycleState: row.lifecycle_state as CandidateMemory['lifecycleState'],
      validFrom: row.valid_from as string,
      validUntil: row.valid_until as string | null,
      retrievalCount: row.retrieval_count as number,
      lastAccessed: row.last_accessed as string | null,
      reinforcementScore: parseFloat(String(row.reinforcement_score)),
      ...(row.similarity_score !== null && row.similarity_score !== undefined
        ? { similarityScore: row.similarity_score as number }
        : {}),
    };
  }

  async updateReinforcement(memoryIds: string[]): Promise<void> {
    this.reinforceBatch({ p_memory_ids: memoryIds });
  }

  async select<T>(params: {
    table: string;
    filters: Record<string, unknown>;
    orderBy?: { column: string; ascending?: boolean };
    limit?: number;
  }): Promise<T[]> {
    let rows = [...this.table(params.table).values()].filter((row) =>
      Object.entries(params.filters).every(([k, v]) => row[k] === v)
    );
    if (params.orderBy) {
      const { column, ascending = true } = params.orderBy;
      rows = rows.sort((a, b) => {
        const av = a[column] as string | number;
        const bv = b[column] as string | number;
        return ascending ? (av > bv ? 1 : -1) : av < bv ? 1 : -1;
      });
    }
    if (params.limit !== undefined) rows = rows.slice(0, params.limit);
    return rows as T[];
  }

  async insert<T>(params: { table: string; values: Record<string, unknown> }): Promise<T> {
    const table = this.table(params.table);
    const id = (params.values.id as string) ?? this.nextId();
    const row = {
      id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      attempts: 0,
      max_attempts: 3,
      ...params.values,
    };
    table.set(id, row);
    return row as T;
  }

  async update<T>(params: {
    table: string;
    filters: Record<string, unknown>;
    values: Record<string, unknown>;
  }): Promise<T[]> {
    const table = this.table(params.table);
    const updated: Record<string, unknown>[] = [];
    for (const row of table.values()) {
      if (Object.entries(params.filters).every(([k, v]) => row[k] === v)) {
        Object.assign(row, params.values);
        updated.push(row);
      }
    }
    return updated as T[];
  }

  async ping(): Promise<boolean> {
    return true;
  }

  /** Test helper — not part of DatabaseAdapter. Seed a memory row directly for test setup. */
  seedMemory(row: Record<string, unknown>): void {
    this.memories.set(row.id as string, row);
  }
}
