-- 012_search_functions.sql
-- Adaprio — adds `search_memories`, needed for both vectorSearch and
-- metadataSearch (Chapter 7.3, 9.9).
--
-- Found while building apps/api/src/adapters/database/supabase.ts: pgvector's
-- `<=>` cosine-distance operator (Ch 7.3: `ORDER BY embedding <=> $vector`)
-- has no equivalent in Supabase's JS query builder — `.order()` only
-- accepts a column name, not an expression. Same class of gap as the
-- pending-queue functions (migration 010): Ch 7.3 describes this as a raw
-- SQL query with no Postgres function backing it.
--
-- One function serves both DatabaseAdapter methods: vector search when
-- `p_query_vector` is supplied, plain recency-ordered metadata filtering
-- when it is not — mirroring how `apply_multi_value_insert` (migration 007)
-- already serves two different repository call-sites.

BEGIN;

CREATE OR REPLACE FUNCTION search_memories(
  p_tenant_id uuid,
  p_user_id text,
  p_lifecycle_filter text[],
  p_limit integer,
  p_query_vector vector(1024) DEFAULT NULL,
  p_category_filter text[] DEFAULT NULL,
  p_entity_key text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  entity_key text,
  value text,
  memory_text text,
  certainty text,
  importance_score numeric,
  lifecycle_state text,
  last_confirmed_at timestamptz,
  valid_until timestamptz,
  retrieval_count integer,
  last_accessed timestamptz,
  reinforcement_score numeric,
  similarity_score double precision
) AS $$
BEGIN
  IF p_query_vector IS NOT NULL THEN
    RETURN QUERY
      SELECT
        m.id, m.entity_key, m.value, m.memory_text, m.certainty::text,
        m.importance_score, m.lifecycle_state::text, m.last_confirmed_at, m.valid_until,
        m.retrieval_count, m.last_accessed, m.reinforcement_score,
        (1 - (m.embedding <=> p_query_vector))::double precision AS similarity_score
      FROM memories m
      WHERE m.tenant_id = p_tenant_id
        AND m.user_id = p_user_id
        AND m.lifecycle_state::text = ANY(p_lifecycle_filter)
        AND (p_category_filter IS NULL OR m.category::text = ANY(p_category_filter))
        AND (p_entity_key IS NULL OR m.entity_key = p_entity_key)
        AND m.embedding IS NOT NULL
      ORDER BY m.embedding <=> p_query_vector
      LIMIT p_limit;
  ELSE
    RETURN QUERY
      SELECT
        m.id, m.entity_key, m.value, m.memory_text, m.certainty::text,
        m.importance_score, m.lifecycle_state::text, m.last_confirmed_at, m.valid_until,
        m.retrieval_count, m.last_accessed, m.reinforcement_score,
        NULL::double precision AS similarity_score
      FROM memories m
      WHERE m.tenant_id = p_tenant_id
        AND m.user_id = p_user_id
        AND m.lifecycle_state::text = ANY(p_lifecycle_filter)
        AND (p_category_filter IS NULL OR m.category::text = ANY(p_category_filter))
        AND (p_entity_key IS NULL OR m.entity_key = p_entity_key)
      ORDER BY m.last_confirmed_at DESC
      LIMIT p_limit;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

COMMIT;

-- ROLLBACK NOTES (migration 012):
-- Pure read-path behavior, no data — safe to drop at any time:
--   DROP FUNCTION IF EXISTS search_memories(uuid, text, text[], integer, vector, text[], text);
-- Dropping while the Worker is still deployed against it surfaces as
-- Postgres 42883 (undefined_function) on every retrieval call — loud
-- failure, not silent wrong results.
