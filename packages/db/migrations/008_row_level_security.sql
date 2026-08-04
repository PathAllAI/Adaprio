-- 008_row_level_security.sql
-- Adaprio — tenant isolation via Postgres Row Level Security (Chapter 9.6, 14.4).
-- CAUTION: see Chapter 34.2 rollback notes — this migration must never be
-- rolled back in any environment holding real tenant data.

BEGIN;

ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_memory_events ENABLE ROW LEVEL SECURITY;

-- The Cloudflare Worker sets this per-request before any data query:
--   SELECT set_config('app.current_tenant_id', $tenant_id, true);
CREATE POLICY tenant_isolation_memories ON memories
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_memory_events ON memory_events
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_pending_memory_events ON pending_memory_events
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- entity_key_registry has no RLS — it is shared reference data (Chapter 9.6).

COMMIT;

-- ROLLBACK NOTES (Chapter 34.2, migration 008):
-- PROHIBITED in any environment with real tenant data — disabling RLS here
-- removes cross-tenant isolation. If a policy predicate is broken in
-- production, the fix is a corrective migration that replaces the policy
-- (DROP POLICY ... ; CREATE POLICY ... with the corrected predicate),
-- never a migration that runs:
--   ALTER TABLE memories DISABLE ROW LEVEL SECURITY;
-- That statement must never appear in a migration file targeting staging
-- or production.
