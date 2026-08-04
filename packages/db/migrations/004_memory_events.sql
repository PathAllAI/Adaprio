-- 004_memory_events.sql
-- Adaprio — append-only audit log, trigger-populated (Chapter 9.2, 9.5, 14.5).

BEGIN;

CREATE TABLE IF NOT EXISTS memory_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  user_id        text NOT NULL,
  memory_id      uuid NOT NULL REFERENCES memories(id),
  entity_key     text NOT NULL,

  -- Event types include: INSERT, ARCHIVE, CORRECT, EXPIRE, DELETE, REINFORCE, RESTORE
  -- (see Chapter 6.2 for why CORRECT is distinct from ARCHIVE)
  event_type     text NOT NULL,

  previous_state jsonb,          -- snapshot of relevant fields before the change
  new_state      jsonb,          -- snapshot of relevant fields after the change

  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_events_tenant_user
  ON memory_events (tenant_id, user_id);

CREATE INDEX IF NOT EXISTS idx_memory_events_memory_id
  ON memory_events (memory_id);

CREATE INDEX IF NOT EXISTS idx_memory_events_entity_key
  ON memory_events (entity_key);

CREATE INDEX IF NOT EXISTS idx_memory_events_created_at
  ON memory_events (created_at);

COMMIT;

-- ROLLBACK NOTES (Chapter 34.2, migration 004):
-- An audit table is never dropped once populated in a real environment.
-- A genuinely empty pre-launch environment may run:
--   DROP TABLE IF EXISTS memory_events;
