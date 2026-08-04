import type { DatabaseAdapter } from '@adaprio/shared-types';
import type { PendingEventRow } from '../types/db.js';

/**
 * ⚠️ `claimBatch` and `markFailed` below call two Postgres functions —
 * `claim_pending_batch` and `mark_pending_failed` — that do NOT exist in
 * migration 007 (which covers only `memories` operations) or anywhere
 * else in the current migration set. This is a genuine gap, not an
 * oversight in this file: both operations need the "lock, then
 * conditional write" transaction pattern Ch 9.9 requires to be a single
 * Postgres function, for reasons specific to each:
 *
 *   - `claimBatch` needs `FOR UPDATE SKIP LOCKED` so two overlapping cron
 *     invocations (Ch 27.7) never claim the same row — a plain `select()`
 *     followed by a separate `update()` from application code has a race
 *     window between the two calls.
 *   - `markFailed` needs an atomic `attempts = attempts + 1` with a
 *     computed status transition (`pending` if under `max_attempts`, else
 *     `failed`) — the generic `update()` primitive only accepts static
 *     values, not a computed expression against the row's current state.
 *
 * Proposed SQL (add to migration 007, or a new migration — not added to
 * any file here, since migration files are being treated as a fixed input
 * to this build, not something to edit unprompted):
 *
 *   CREATE OR REPLACE FUNCTION claim_pending_batch(p_limit integer)
 *   RETURNS SETOF pending_memory_events AS $$
 *   BEGIN
 *     RETURN QUERY
 *       UPDATE pending_memory_events
 *       SET status = 'processing', updated_at = now()
 *       WHERE id IN (
 *         SELECT id FROM pending_memory_events
 *         WHERE status = 'pending' AND attempts < max_attempts
 *         ORDER BY created_at
 *         LIMIT p_limit
 *         FOR UPDATE SKIP LOCKED
 *       )
 *       RETURNING *;
 *   END;
 *   $$ LANGUAGE plpgsql;
 *
 *   CREATE OR REPLACE FUNCTION mark_pending_failed(p_id uuid, p_error text)
 *   RETURNS pending_memory_events AS $$
 *   DECLARE v_row pending_memory_events;
 *   BEGIN
 *     UPDATE pending_memory_events
 *     SET attempts = attempts + 1,
 *         last_error = p_error,
 *         status = CASE WHEN attempts + 1 >= max_attempts THEN 'failed' ELSE 'pending' END,
 *         updated_at = now()
 *     WHERE id = p_id
 *     RETURNING * INTO v_row;
 *     RETURN v_row;
 *   END;
 *   $$ LANGUAGE plpgsql;
 *
 * Both calls below will fail with Postgres 42883 (undefined_function) until
 * one of these is added. `enqueue` and `markProcessed` need no such
 * function — they're single-table, single-statement, unconditional writes,
 * so the generic `insert()`/`update()` primitives are sufficient per Ch 9.9's
 * transaction boundary rule.
 */
export class PendingRepository {
  constructor(private readonly db: DatabaseAdapter) {}

  /** Ch 04, provider-outage path — never drop a message, queue it instead. */
  async enqueue(params: {
    tenantId: string;
    userId: string;
    sessionId?: string;
    message: string;
  }): Promise<PendingEventRow> {
    return this.db.insert<PendingEventRow>({
      table: 'pending_memory_events',
      values: {
        tenant_id: params.tenantId,
        user_id: params.userId,
        session_id: params.sessionId ?? null,
        message: params.message,
        status: 'pending',
      },
    });
  }

  /** ⚠️ Requires `claim_pending_batch` — see class-level note above. */
  async claimBatch(limit: number): Promise<PendingEventRow[]> {
    return this.db.rpc<PendingEventRow[]>('claim_pending_batch', { p_limit: limit });
  }

  /** Success path — single unconditional field update, no RPC function needed. */
  async markProcessed(id: string): Promise<void> {
    await this.db.update<PendingEventRow>({
      table: 'pending_memory_events',
      filters: { id },
      values: { status: 'processed', updated_at: new Date().toISOString() },
    });
  }

  /** ⚠️ Requires `mark_pending_failed` — see class-level note above. */
  async markFailed(id: string, error: string): Promise<void> {
    await this.db.rpc<PendingEventRow>('mark_pending_failed', { p_id: id, p_error: error });
  }
}
