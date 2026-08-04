-- 009_amm_tenants.sql
-- Adaprio — customer account / API key / rate-limit tier table.
-- Previously referenced throughout the handbook (Chapter 9.1, 10.1, 17.9,
-- 18.1) but the DDL did not exist. Flagged as a High-priority gap in the
-- v1.1.0 Upgrade Summary — resolved here.

BEGIN;

CREATE TABLE IF NOT EXISTS amm_tenants (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_name           text NOT NULL,

  -- API keys are never stored in plaintext — only a salted hash, verified
  -- by src/lib/auth.ts (Chapter 23.7). The prefix is stored separately so
  -- the dashboard can display "amm_live_ab12..." without ever holding the
  -- full key server-side after issuance.
  api_key_prefix     text NOT NULL,
  api_key_hash       text NOT NULL,

  rate_limit_tier    text NOT NULL DEFAULT 'starter', -- starter | pro | enterprise (Chapter 10.7)
  rate_limit_writes_per_min      integer NOT NULL DEFAULT 60,
  rate_limit_retrievals_per_min  integer NOT NULL DEFAULT 120,

  -- Chapter 18.3: dedicated deployments for data-residency customers [FUTURE]
  dedicated_region   text,

  status             text NOT NULL DEFAULT 'active', -- active | suspended | cancelled

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_amm_tenants_api_key_hash UNIQUE (api_key_hash)
);

CREATE INDEX IF NOT EXISTS idx_amm_tenants_api_key_prefix
  ON amm_tenants (api_key_prefix);

CREATE INDEX IF NOT EXISTS idx_amm_tenants_status
  ON amm_tenants (status);

-- amm_tenants uses a different RLS policy than customer data tables: it is
-- readable only by the service role context (the Worker's own connection),
-- never by a request-scoped `app.current_tenant_id` setting, since a tenant
-- must not be able to query other tenants' account rows even by accident.
ALTER TABLE amm_tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_only ON amm_tenants
  USING (current_setting('role', true) = 'service_role');

COMMIT;

-- ROLLBACK NOTES (Chapter 34.2, migration 009):
-- Safe to drop until Phase 3 API-key validation reads from it in production;
-- once that ships, treat like 003/004 (no direct DROP TABLE with live data):
--   DROP TABLE IF EXISTS amm_tenants;
