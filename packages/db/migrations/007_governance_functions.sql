-- 007_governance_functions.sql
-- Adaprio — governance transaction functions (Chapter 6.2, 9.9).
-- Each function is a single, atomic Postgres transaction called via
-- `supabase.rpc(...)` from src/repositories/governance-repository.ts.
-- No application code assembles these operations as separate client calls.

BEGIN;

-- Conflict Rule 1: Direct Replacement
CREATE OR REPLACE FUNCTION apply_direct_replacement(
  p_tenant_id uuid,
  p_user_id text,
  p_entity_key text,
  p_value text,
  p_memory_text text,
  p_certainty certainty_level,
  p_embedding vector(1024)
) RETURNS memories AS $$
DECLARE
  v_old_id uuid;
  v_new_row memories;
BEGIN
  SELECT id INTO v_old_id
  FROM memories
  WHERE tenant_id = p_tenant_id AND user_id = p_user_id
    AND entity_key = p_entity_key AND lifecycle_state = 'active' AND certainty = 'confirmed'
  FOR UPDATE;

  INSERT INTO memories (
    tenant_id, user_id, entity_key, value, memory_text,
    certainty, lifecycle_state, previous_version_id, embedding
  )
  VALUES (
    p_tenant_id, p_user_id, p_entity_key, p_value, p_memory_text,
    p_certainty, 'active', v_old_id, p_embedding
  )
  RETURNING * INTO v_new_row;

  IF v_old_id IS NOT NULL THEN
    UPDATE memories
    SET lifecycle_state = 'superseded', valid_until = now(), superseded_by = v_new_row.id
    WHERE id = v_old_id;
  END IF;

  RETURN v_new_row;
END;
$$ LANGUAGE plpgsql;

-- Conflict Rule 3: Departure Without Replacement
CREATE OR REPLACE FUNCTION apply_departure(
  p_tenant_id uuid,
  p_user_id text,
  p_entity_key text
) RETURNS void AS $$
BEGIN
  UPDATE memories
  SET lifecycle_state = 'historical',
      valid_until = now(),
      is_negation = true,
      archive_reason = 'user_departure'
  WHERE tenant_id = p_tenant_id AND user_id = p_user_id
    AND entity_key = p_entity_key AND lifecycle_state = 'active';
END;
$$ LANGUAGE plpgsql;

-- Conflict Rule 4: Retroactive Correction
CREATE OR REPLACE FUNCTION apply_correction(
  p_tenant_id uuid,
  p_user_id text,
  p_entity_key text,
  p_value_pattern text
) RETURNS integer AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE memories
  SET lifecycle_state = 'deleted',
      is_correction = true,
      archive_reason = 'user_correction'
  WHERE tenant_id = p_tenant_id AND user_id = p_user_id AND entity_key = p_entity_key
    AND value ILIKE '%' || p_value_pattern || '%'
    AND lifecycle_state IN ('active', 'historical', 'superseded');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Multi-value entity insert (Chapter 6.5) — independent row, no conflict rule applies
CREATE OR REPLACE FUNCTION apply_multi_value_insert(
  p_tenant_id uuid,
  p_user_id text,
  p_entity_key text,
  p_value text,
  p_memory_text text,
  p_certainty certainty_level,
  p_embedding vector(1024)
) RETURNS memories AS $$
DECLARE
  v_new_row memories;
BEGIN
  INSERT INTO memories (tenant_id, user_id, entity_key, value, memory_text, certainty, lifecycle_state, embedding)
  VALUES (p_tenant_id, p_user_id, p_entity_key, p_value, p_memory_text, p_certainty, 'active', p_embedding)
  RETURNING * INTO v_new_row;

  RETURN v_new_row;
END;
$$ LANGUAGE plpgsql;

-- Reinforcement (Chapter 6.4) — fire-and-forget after retrieval, batched by memory id
CREATE OR REPLACE FUNCTION reinforce_batch(p_memory_ids uuid[]) RETURNS void AS $$
BEGIN
  UPDATE memories
  SET retrieval_count = retrieval_count + 1,
      last_accessed = now(),
      reinforcement_score = LEAST(1.0, reinforcement_score + 0.05),
      importance_score = LEAST(1.0, importance_score + 0.02),
      expires_at = CASE
        WHEN ttl_policy IN ('short', 'medium', 'long') AND expires_at IS NOT NULL
          THEN GREATEST(expires_at, now() + interval '7 days')
        ELSE expires_at
      END
  WHERE id = ANY(p_memory_ids);
END;
$$ LANGUAGE plpgsql;

COMMIT;

-- ROLLBACK NOTES (Chapter 34.2, migration 007):
-- Safe to drop; a dropped function call fails loudly (42883 undefined_function)
-- rather than silently, which is the desired failure mode if rolled back
-- while application code still expects it (it shouldn't be — see 17.10):
--   DROP FUNCTION IF EXISTS reinforce_batch(uuid[]);
--   DROP FUNCTION IF EXISTS apply_multi_value_insert(uuid, text, text, text, text, certainty_level, vector);
--   DROP FUNCTION IF EXISTS apply_correction(uuid, text, text, text);
--   DROP FUNCTION IF EXISTS apply_departure(uuid, text, text);
--   DROP FUNCTION IF EXISTS apply_direct_replacement(uuid, text, text, text, text, certainty_level, vector);
