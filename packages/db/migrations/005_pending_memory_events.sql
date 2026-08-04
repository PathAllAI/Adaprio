-- 005_pending_memory_events.sql
-- Adaprio — outage queue for write-path failures (Chapter 4, 27.7).
-- Purely operational; never a system of record.

BEGIN;

CREATE TABLE IF NOT EXISTS pending_memory_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  user_id         text NOT NULL,
  session_id      text,
  message         text NOT NULL,
  status          text NOT NULL DEFAULT 'pending', -- pending | processing | processed | failed
  attempts        integer NOT NULL DEFAULT 0,
  max_attempts    integer NOT NULL DEFAULT 3,       -- MAX_PENDING_ATTEMPTS (Chapter 17.9)
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pending_events_status
  ON pending_memory_events (status);

COMMIT;

-- ROLLBACK NOTES (Chapter 34.2, migration 005):
-- Safe at any time — this table holds only in-flight operational state:
--   DROP TABLE IF EXISTS pending_memory_events;
