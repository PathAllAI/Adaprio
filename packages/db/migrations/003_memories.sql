-- 003_memories.sql
-- Adaprio — the core, versioned, governed memory store (Chapter 09.3, 09.4).

BEGIN;

CREATE TABLE IF NOT EXISTS memories (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  user_id               text NOT NULL,                 -- customer-supplied, not authenticated by Adaprio (8.5)
  entity_key            text NOT NULL,
  category              text,                           -- auto-filled from entity_key domain (before_insert trigger)

  -- Chapter 9.3: value vs memory_text are intentionally separate columns
  value                 text NOT NULL,                   -- short normalized fact, used for conflict detection/dedup
  memory_text           text NOT NULL,                   -- natural-language form, used for embedding + retrieval

  certainty             certainty_level NOT NULL DEFAULT 'confirmed',
  lifecycle_state       lifecycle_state NOT NULL DEFAULT 'active',

  -- Governance / conflict-rule bookkeeping (Chapter 6.2)
  is_negation           boolean NOT NULL DEFAULT false,
  is_correction         boolean NOT NULL DEFAULT false,
  archive_reason        text,
  previous_version_id   uuid REFERENCES memories(id),
  superseded_by         uuid REFERENCES memories(id),
  version               integer NOT NULL DEFAULT 1,

  -- Scoring (Chapter 5.3, 6.4, 7.5)
  confidence            numeric(4,3) NOT NULL DEFAULT 1.000,
  importance_score      numeric(4,3) NOT NULL DEFAULT 0.500,
  reinforcement_score   numeric(4,3) NOT NULL DEFAULT 0.000,
  retrieval_count       integer NOT NULL DEFAULT 0,

  -- TTL (Chapter 5.4)
  ttl_policy            ttl_policy,
  expires_at            timestamptz,
  valid_until            timestamptz,
  last_accessed         timestamptz,
  last_confirmed_at     timestamptz NOT NULL DEFAULT now(),

  -- Embedding (Chapter 5.5, 9.3): Qwen3-Embedding-0.6B native dimension
  embedding             vector(1024),

  -- Optimistic locking (Chapter 9.3)
  lock_version          integer NOT NULL DEFAULT 1,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- 9.4 Index Strategy
CREATE INDEX IF NOT EXISTS idx_memories_active_lookup
  ON memories (tenant_id, user_id, entity_key)
  WHERE lifecycle_state = 'active';

CREATE INDEX IF NOT EXISTS idx_memories_tenant_user
  ON memories (tenant_id, user_id);

CREATE INDEX IF NOT EXISTS idx_memories_category
  ON memories (category);

CREATE INDEX IF NOT EXISTS idx_memories_lifecycle_state
  ON memories (lifecycle_state);

CREATE INDEX IF NOT EXISTS idx_memories_expires_at
  ON memories (expires_at)
  WHERE expires_at IS NOT NULL;

-- ivfflat for MVP (Chapter 9.4); migrate to hnsw when p99 vector search > 50ms.
-- Requires ANALYZE after representative row counts exist.
CREATE INDEX IF NOT EXISTS idx_memories_embedding
  ON memories USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

COMMIT;

-- ROLLBACK NOTES (Chapter 34.2, migration 003):
-- Never DROP TABLE in an environment with data. Recovery from a bad 003
-- deploy is Supabase point-in-time-recovery, not a reverse migration.
-- A genuinely empty pre-launch environment may run:
--   DROP TABLE IF EXISTS memories CASCADE;
