-- 015_sweep_expired_memories.sql
-- Adaprio — adds `sweep_expired_memories`, needed for the ttl-sweep cron
-- job (Ch 04.8, 27.6).
--
-- Same class of gap as `claim_pending_batch` (migration 010): Ch 27.6's
-- sequence diagram shows this as a SELECT ... FOR UPDATE SKIP LOCKED
-- followed by a separate UPDATE, which needs to be one atomic Postgres
-- function so two overlapping ttl-sweep cron ticks never race on the same
-- rows. No function backing this existed anywhere in migrations 001–014.

BEGIN;

CREATE OR REPLACE FUNCTION sweep_expired_memories(p_limit integer)
RETURNS SETOF memories AS $$
BEGIN
  RETURN QUERY
    UPDATE memories
    SET lifecycle_state = 'expired',
        valid_until = now()
    WHERE id IN (
      SELECT id FROM memories
      WHERE expires_at < now() AND lifecycle_state = 'active'
      ORDER BY expires_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
END;
$$ LANGUAGE plpgsql;

COMMIT;

-- ROLLBACK NOTES (migration 015):
-- Safe to drop at any time — pure behavior, not data:
--   DROP FUNCTION IF EXISTS sweep_expired_memories(integer);
-- Dropping while the ttl-sweep cron is still deployed against it surfaces
-- as Postgres 42883 (undefined_function) on the next tick — loud, not
-- silent (memories simply stop expiring, which is safe-but-stale, not
-- destructive).
