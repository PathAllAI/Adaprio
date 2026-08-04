-- 010_pending_queue_functions.sql
-- Adaprio — pending_memory_events queue functions (Chapter 4.8, 27.7).
--
-- Proposed while building apps/api/src/repositories/pending-repository.ts:
-- migration 007 covers only `memories` conflict-rule functions. Nothing in
-- the existing migration set backs claiming a batch of pending events or
-- atomically recording a failed retry attempt, and both operations need
-- the "lock, then conditional write" pattern that Chapter 9.9 requires to
-- be a single Postgres function, not sequential client-side calls:
--
--   - claim_pending_batch: needs FOR UPDATE SKIP LOCKED so two overlapping
--     `pending-retry` cron invocations (Ch 27.7) never claim the same row.
--   - mark_pending_failed: needs an atomic `attempts = attempts + 1` with a
--     computed status transition — a plain UPDATE with static values can't
--     express "pending if still under max_attempts, else failed" safely
--     against a value the row already holds.

BEGIN;

CREATE OR REPLACE FUNCTION claim_pending_batch(p_limit integer)
RETURNS SETOF pending_memory_events AS $$
BEGIN
  RETURN QUERY
    UPDATE pending_memory_events
    SET status = 'processing',
        updated_at = now()
    WHERE id IN (
      SELECT id FROM pending_memory_events
      WHERE status = 'pending' AND attempts < max_attempts
      ORDER BY created_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION mark_pending_failed(p_id uuid, p_error text)
RETURNS pending_memory_events AS $$
DECLARE
  v_row pending_memory_events;
BEGIN
  UPDATE pending_memory_events
  SET attempts = attempts + 1,
      last_error = p_error,
      status = CASE WHEN attempts + 1 >= max_attempts THEN 'failed' ELSE 'pending' END,
      updated_at = now()
  WHERE id = p_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mark_pending_failed: no pending_memory_events row with id %', p_id;
  END IF;

  RETURN v_row;
END;
$$ LANGUAGE plpgsql;

COMMIT;

-- ROLLBACK NOTES (Chapter 34.2 style, migration 010):
-- Safe to drop at any time — these are pure behavior over an operational
-- queue table, not data:
--   DROP FUNCTION IF EXISTS mark_pending_failed(uuid, text);
--   DROP FUNCTION IF EXISTS claim_pending_batch(integer);
-- Dropping while the pending-retry cron (Ch 27.7) is still deployed against
-- them will surface as Postgres 42883 (undefined_function) on the next
-- cron tick — loud, not silent, consistent with the failure-mode preference
-- stated in migration 007's own rollback notes.
