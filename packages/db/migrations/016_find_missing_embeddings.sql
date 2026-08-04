-- 016_find_missing_embeddings.sql
-- Adaprio — adds `find_missing_embeddings`, needed for the
-- embedding-backfill cron job (Ch 04.8, 05.5).
--
-- Found while building src/cron/embedding-backfill.ts: finding rows where
-- `embedding IS NULL` needs an IS NULL check, which Supabase's JS query
-- builder expresses via `.is(column, null)` — a different builder method
-- from the `.eq()` used everywhere else in this codebase's generic
-- `DatabaseAdapter.select()`. Rather than special-casing null values
-- inside that shared generic primitive (which every other caller of
-- `select()` would then need to reason about), this is a small dedicated
-- function — consistent with how `claim_pending_batch` and
-- `sweep_expired_memories` were each kept to one specific, narrow need
-- rather than generalizing a shared primitive further.
--
-- No locking required here (unlike claim_pending_batch/sweep_expired_memories)
-- — two overlapping backfill runs picking the same rows is wasteful, not
-- incorrect: re-embedding an already-embedded row and overwriting it with
-- an equivalent vector is idempotent.

BEGIN;

CREATE OR REPLACE FUNCTION find_missing_embeddings(p_limit integer)
RETURNS TABLE (id uuid, memory_text text) AS $$
  SELECT m.id, m.memory_text
  FROM memories m
  WHERE m.embedding IS NULL
    AND m.lifecycle_state != 'deleted'
  ORDER BY m.created_at
  LIMIT p_limit;
$$ LANGUAGE sql STABLE;

COMMIT;

-- ROLLBACK NOTES (migration 016):
-- Safe to drop at any time — pure read behavior, not data:
--   DROP FUNCTION IF EXISTS find_missing_embeddings(integer);
-- Dropping while the embedding-backfill cron is still deployed against it
-- surfaces as Postgres 42883 (undefined_function) on the next tick — loud,
-- not silent (affected rows simply stay unembedded and unavailable for
-- vector search, which is safe-but-degraded, not destructive).
