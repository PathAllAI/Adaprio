-- 017_fix_direct_replacement_ordering.sql
-- Adaprio — fixes a real bug in apply_direct_replacement (migration 007),
-- found from a live production error, not a design review.
--
-- Original ordering: SELECT old row -> INSERT new row (as 'active') ->
-- UPDATE old row to 'superseded'. The INSERT fires
-- `enforce_single_active_per_entity` (migration 006) BEFORE the insert
-- completes — at that point the old row is STILL 'active', since it isn't
-- archived until the step AFTER the insert. The trigger correctly sees two
-- active+confirmed rows for the same non-multi-value entity_key and
-- rejects with AMM2001 ("more than one active confirmed record").
--
-- This means every Rule 1 replacement (Ch 6.2) — the single most common
-- governance operation, "the user's employer/city/role changed" — failed
-- for every entity_key that already had a confirmed active value. It only
-- ever worked for the FIRST write to a brand-new entity_key, where
-- v_old_id is NULL and there is nothing to collide with.
--
-- Fix: archive the old row FIRST, then insert the new one. The two-way
-- pointer linkage (previous_version_id on the new row, superseded_by on
-- the old row) is unchanged — only the order of operations moves.

BEGIN;

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

  -- Archive the old row FIRST — before inserting the new active row —
  -- so enforce_single_active_per_entity (migration 006) never observes
  -- both rows as active simultaneously when its BEFORE INSERT check runs.
  IF v_old_id IS NOT NULL THEN
    UPDATE memories
    SET lifecycle_state = 'superseded', valid_until = now()
    WHERE id = v_old_id;
  END IF;

  INSERT INTO memories (
    tenant_id, user_id, entity_key, value, memory_text,
    certainty, lifecycle_state, previous_version_id, embedding
  )
  VALUES (
    p_tenant_id, p_user_id, p_entity_key, p_value, p_memory_text,
    p_certainty, 'active', v_old_id, p_embedding
  )
  RETURNING * INTO v_new_row;

  -- Back-fill the forward pointer now that the new row's id exists.
  IF v_old_id IS NOT NULL THEN
    UPDATE memories SET superseded_by = v_new_row.id WHERE id = v_old_id;
  END IF;

  RETURN v_new_row;
END;
$$ LANGUAGE plpgsql;

COMMIT;

-- ROLLBACK NOTES (migration 017):
-- Reverting restores the bug — every Rule 1 replacement past the first
-- write would fail again with AMM2001. Only revert if this fix somehow
-- introduces a worse regression, and fix forward instead of rolling back
-- if at all possible:
--   -- re-apply migration 007's original apply_direct_replacement body
