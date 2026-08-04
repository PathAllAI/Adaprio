-- 011_fix_restore_event_classification.sql
-- Adaprio — corrects log_memory_event() to classify RESTORE transitions
-- (Chapter 6.1, 9.5, 27.12), which migration 006 documented but never
-- implemented.
--
-- Found while reconciling packages/shared-types' MemoryEventType against
-- this trigger's actual output: migration 004's comment and the Ch 06.1 /
-- 27.12 state diagrams both describe `historical|expired -> active` as a
-- RESTORE transition, but no branch in the original log_memory_event()
-- (migration 006) ever assigns 'RESTORE' — it fell through to the final
-- `ELSE 'UPDATE'` branch instead, indistinguishable from an ordinary field
-- edit. This matters for the dashboard version-history view (Ch 13),
-- which needs to show "restored" distinctly from "updated."
--
-- Scope note: this migration ONLY fixes event classification. It does NOT
-- add enforcement of the forbidden-transition rules from Ch 27.12
-- (`superseded -> active` and `deleted -> active` are documented as
-- forbidden but nothing in the current migration set actually rejects
-- them at the database layer). That is a separate, larger piece of work —
-- flagged here, not bundled in, so this migration stays a pure
-- classification fix with an easy, isolated rollback.

BEGIN;

CREATE OR REPLACE FUNCTION log_memory_event() RETURNS trigger AS $$
DECLARE
  v_event_type text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event_type := 'INSERT';
  ELSIF NEW.is_correction AND NOT OLD.is_correction THEN
    v_event_type := 'CORRECT';
  ELSIF NEW.lifecycle_state = 'active' AND OLD.lifecycle_state IN ('historical', 'expired') THEN
    -- NEW: the branch migration 006 was missing. Deliberately excludes
    -- 'superseded' and 'deleted' as prior states — both are forbidden
    -- transitions into 'active' per Ch 27.12 and should never reach this
    -- trigger as a legitimate RESTORE in the first place; see the scope
    -- note above for why this migration doesn't also add that enforcement.
    v_event_type := 'RESTORE';
  ELSIF NEW.lifecycle_state = 'superseded' AND OLD.lifecycle_state = 'active' THEN
    v_event_type := 'ARCHIVE';
  ELSIF NEW.lifecycle_state = 'historical' AND OLD.lifecycle_state = 'active' THEN
    v_event_type := 'ARCHIVE';
  ELSIF NEW.lifecycle_state = 'expired' AND OLD.lifecycle_state = 'active' THEN
    v_event_type := 'EXPIRE';
  ELSIF NEW.lifecycle_state = 'deleted' THEN
    v_event_type := 'DELETE';
  ELSIF NEW.retrieval_count > OLD.retrieval_count THEN
    v_event_type := 'REINFORCE';
  ELSE
    v_event_type := 'UPDATE';
  END IF;

  INSERT INTO memory_events (tenant_id, user_id, memory_id, entity_key, event_type, previous_state, new_state)
  VALUES (
    NEW.tenant_id, NEW.user_id, NEW.id, NEW.entity_key, v_event_type,
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    to_jsonb(NEW)
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- No CREATE TRIGGER needed — trg_log_memory_event (migration 006) already
-- points at this function by name; CREATE OR REPLACE FUNCTION updates its
-- body in place.

COMMIT;

-- ROLLBACK NOTES (Chapter 34.2 style, migration 011):
-- Reverts cleanly to the migration 006 behavior (RESTORE transitions
-- misclassified as UPDATE) by re-running 006's original CREATE OR REPLACE
-- FUNCTION log_memory_event() body. Pure behavior, not data — safe to roll
-- back at any time, though any RESTORE events already logged correctly
-- under this version stay correctly labeled; rollback only affects events
-- logged AFTER the rollback.
