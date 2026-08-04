-- 002_entity_key_registry.sql
-- Adaprio — the frozen 60-key entity taxonomy (Chapter 08, Appendix A).
-- Read-only at runtime: only migrations and the generated seed script write here.

BEGIN;

CREATE TABLE IF NOT EXISTS entity_key_registry (
  entity_key           text PRIMARY KEY,               -- e.g. 'employment.organization'
  domain               text NOT NULL,                  -- e.g. 'employment'
  description          text NOT NULL,
  allows_multiple      boolean NOT NULL DEFAULT false,
  allows_versioning    boolean NOT NULL DEFAULT true,
  default_ttl_policy   ttl_policy NOT NULL,
  default_ttl_days     integer,                        -- NULL for until_changed / permanent
  sensitivity          sensitivity_level NOT NULL DEFAULT 'low',
  deprecated           boolean NOT NULL DEFAULT false,  -- Chapter 8.6 extension policy
  created_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_entity_key_format
    CHECK (entity_key ~ '^[a-z0-9_]+\.[a-z0-9_]+$'),

  -- Chapter 8.2 constraint: a multi-value key cannot form a version chain
  CONSTRAINT chk_no_multi_and_versioned
    CHECK (NOT (allows_multiple AND allows_versioning))
);

CREATE INDEX IF NOT EXISTS idx_entity_key_registry_domain
  ON entity_key_registry (domain);

COMMIT;

-- Seeding: see seed/seed_entity_registry.sql (generated from Appendix A).
-- This table has no RLS (Chapter 9.6) — it is shared reference data.

-- ROLLBACK NOTES (Chapter 34.2, migration 002):
-- Safe only before migration 003 runs:
--   DROP TABLE IF EXISTS entity_key_registry;
-- After 003, `memories.entity_key` has no FK to this table by design (9.2),
-- but application code assumes every row here exists — do not drop in any
-- environment with live application traffic.
