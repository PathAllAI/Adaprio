/**
 * ⚠️ RECONCILIATION NOTE, found while building src/pipeline/write.ts:
 * Ch 05.5 and the Ch 04 failure-mode table both promise that a failed
 * embedding call degrades gracefully — "memory stored with null embedding,
 * backfilled within 30 minutes." But every migration 007 function takes
 * `p_embedding` as a required parameter to the SAME atomic INSERT that
 * creates the row — there is no separate "insert, then update embedding"
 * step in the SQL as written. Ch 04.8's diagram shows embed as step 7,
 * AFTER governance (step 6) — that ordering doesn't match what the SQL
 * actually requires.
 *
 * Resolution used throughout this file and memory-repository.ts: embedding
 * is generated BEFORE governance runs (matching what the SQL needs), and a
 * FAILED embedding call passes `embedding: null` through instead of
 * blocking the write — `memories.embedding` has no NOT NULL constraint
 * (migration 003), so Postgres accepts a null vector at insert time, and
 * the embedding-backfill cron (Ch 04.8, every 30 min) still finds and
 * fills these rows exactly as Ch 05.5 describes. The net behavior promised
 * to the handbook reader is preserved; only the internal step ordering
 * changes. Confirm this reconciliation, or request migration 007 be split
 * into insert-without-embedding + separate embed-update RPCs if the
 * literal Ch 04.8 ordering matters for another reason not visible here.
 */
import type { Certainty, DatabaseAdapter, EntityKey } from '@adaprio/shared-types';
import type { MemoryRow } from '../types/db.js';

/**
 * The only place `governance-repository`-owned RPC functions get called.
 * `src/engine/governance.ts` (Ch 06 — the four conflict rules) depends on
 * this class and never constructs SQL or calls `adapter.rpc()` directly
 * (Ch 9.9). Each method name describes the operation in domain terms, one
 * per migration 007 function.
 */
export class GovernanceRepository {
  constructor(private readonly db: DatabaseAdapter) {}

  /**
   * Conflict Rule 1 — Direct Replacement (Ch 06.2). Archives the existing
   * active+confirmed row for this entity_key (if any) and inserts the new
   * one as the next version, atomically, inside `apply_direct_replacement`
   * (migration 007). Safe to call even when no prior active row exists —
   * the function's `v_old_id` is simply NULL and no archive happens.
   */
  async applyDirectReplacement(params: {
    tenantId: string;
    userId: string;
    entityKey: EntityKey;
    value: string;
    memoryText: string;
    certainty: Certainty;
    embedding: number[] | null;
  }): Promise<MemoryRow> {
    return this.db.rpc<MemoryRow>('apply_direct_replacement', {
      p_tenant_id: params.tenantId,
      p_user_id: params.userId,
      p_entity_key: params.entityKey,
      p_value: params.value,
      p_memory_text: params.memoryText,
      p_certainty: params.certainty,
      p_embedding: params.embedding,
    });
  }

  /**
   * Conflict Rule 3 — Departure Without Replacement (Ch 06.2). Transitions
   * the active row to `historical` with `is_negation = true`. Inserts
   * nothing. If no active row exists for this entity_key, the underlying
   * `UPDATE` affects zero rows — `apply_departure` returns `void` either
   * way, so the caller (governance engine) cannot distinguish "archived
   * one row" from "there was nothing to archive" from this call alone.
   * If that distinction matters to a caller, check `activeMemoryFor()`
   * (memory-repository.ts) immediately beforehand.
   */
  async applyDeparture(params: { tenantId: string; userId: string; entityKey: EntityKey }): Promise<void> {
    await this.db.rpc<null>('apply_departure', {
      p_tenant_id: params.tenantId,
      p_user_id: params.userId,
      p_entity_key: params.entityKey,
    });
  }

  /**
   * Conflict Rule 4 — Retroactive Correction (Ch 06.2). Matches rows by
   * substring (`value ILIKE '%pattern%'`) across active/historical/
   * superseded lifecycle states and marks them `deleted` with
   * `is_correction = true`. Returns the number of rows affected —
   * `0` means no matching memory was found (surface as AMM2006
   * `CorrectionTargetNotFound`; this is informational, not necessarily an
   * error, per the Ch 28 catalog entry). `valuePattern` should be a
   * distinctive fragment ("Google"), not a full sentence — the match is a
   * plain substring, not a semantic one.
   */
  async applyCorrection(params: {
    tenantId: string;
    userId: string;
    entityKey: EntityKey;
    valuePattern: string;
  }): Promise<number> {
    return this.db.rpc<number>('apply_correction', {
      p_tenant_id: params.tenantId,
      p_user_id: params.userId,
      p_entity_key: params.entityKey,
      p_value_pattern: params.valuePattern,
    });
  }

  /**
   * Multi-value entity insert (Ch 06.5) — an independent row, no conflict
   * rule applies. Use this for entity_keys where
   * `entity_key_registry.allows_multiple = true` (skills, preferences,
   * projects, etc.).
   *
   * For the tentative/future-state case (Rule 2), see
   * `memory-repository.ts#insertTentative`, which calls this SAME
   * underlying function under a different repository method name — see
   * the note there for why that reuse is safe.
   */
  async applyMultiValueInsert(params: {
    tenantId: string;
    userId: string;
    entityKey: EntityKey;
    value: string;
    memoryText: string;
    certainty: Certainty;
    embedding: number[] | null;
  }): Promise<MemoryRow> {
    return this.db.rpc<MemoryRow>('apply_multi_value_insert', {
      p_tenant_id: params.tenantId,
      p_user_id: params.userId,
      p_entity_key: params.entityKey,
      p_value: params.value,
      p_memory_text: params.memoryText,
      p_certainty: params.certainty,
      p_embedding: params.embedding,
    });
  }

  /**
   * TTL expiry sweep (Ch 04.8, 27.6) — called by the ttl-sweep cron job,
   * never from the request-handling path. Backed by
   * `sweep_expired_memories` (migration 015, proposed).
   */
  async sweepExpired(limit: number): Promise<MemoryRow[]> {
    return this.db.rpc<MemoryRow[]>('sweep_expired_memories', { p_limit: limit });
  }
}
