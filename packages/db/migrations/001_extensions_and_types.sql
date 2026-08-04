-- 001_extensions_and_types.sql
-- Adaprio — enables required Postgres extensions and defines shared enum types.
-- See Handbook Chapter 09 (Database Design) and Chapter 34 (Migrations).

BEGIN;

-- pgvector: stores and indexes memory embeddings (Chapter 9.3)
CREATE EXTENSION IF NOT EXISTS vector;

-- pgcrypto: field-level encryption for high-sensitivity entity values (Chapter 8.4, 14.2)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Lifecycle state machine (Chapter 6.1)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lifecycle_state') THEN
    CREATE TYPE lifecycle_state AS ENUM (
      'active',
      'historical',
      'superseded',
      'expired',
      'deleted'
    );
  END IF;
END $$;

-- Certainty classification (Chapter 5.2, Conflict Rule 2)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'certainty_level') THEN
    CREATE TYPE certainty_level AS ENUM (
      'confirmed',
      'tentative'
    );
  END IF;
END $$;

-- TTL policy classification (Chapter 5.4, 8.3)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ttl_policy') THEN
    CREATE TYPE ttl_policy AS ENUM (
      'short',        -- 14 days base
      'medium',       -- 90 days base
      'long',         -- 365 days base
      'until_changed',-- no expiry; superseded only by a new value
      'permanent'     -- no expiry, ever
    );
  END IF;
END $$;

-- Sensitivity classification (Chapter 8.4)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sensitivity_level') THEN
    CREATE TYPE sensitivity_level AS ENUM (
      'low',
      'medium',
      'high'
    );
  END IF;
END $$;

COMMIT;

-- ROLLBACK NOTES (Chapter 34.2, migration 001):
-- Types may be dropped safely if no dependent table exists yet:
--   DROP TYPE IF EXISTS sensitivity_level;
--   DROP TYPE IF EXISTS ttl_policy;
--   DROP TYPE IF EXISTS certainty_level;
--   DROP TYPE IF EXISTS lifecycle_state;
-- Extensions (pgvector, pgcrypto) are left installed even on rollback of this
-- migration; dropping them is only safe if no table anywhere in the database
-- references a `vector(...)` column or a pgcrypto function, which is never
-- true once migration 003 has been applied.
