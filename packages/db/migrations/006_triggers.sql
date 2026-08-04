-- 006_triggers.sql
-- Adaprio — four triggers on `memories` (Chapter 9.5).

BEGIN;

-- 1. BEFORE INSERT: auto-fill category, ttl_policy, expires_at, version from registry
CREATE OR REPLACE FUNCTION memories_before_insert() RETURNS trigger AS $$
DECLARE
  v_registry entity_key_registry;
BEGIN
  SELECT * INTO v_registry FROM entity_key_registry WHERE entity_key = NEW.entity_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMM7002: entity_key % not registered in entity_key_registry', NEW.entity_key;
  END IF;

  NEW.category := v_registry.domain;
  NEW.ttl_policy := COALESCE(NEW.ttl_policy, v_registry.default_ttl_policy);

  IF v_registry.default_ttl_policy IN ('short', 'medium', 'long') AND NEW.expires_at IS NULL THEN
    NEW.expires_at := now() + make_interval(days => v_registry.default_ttl_days);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_memories_before_insert
  BEFORE INSERT ON memories
  FOR EACH ROW EXECUTE FUNCTION memories_before_insert();

-- 2. BEFORE UPDATE: bump updated_at, increment lock_version
CREATE OR REPLACE FUNCTION memories_before_update() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  NEW.lock_version := OLD.lock_version + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_memories_before_update
  BEFORE UPDATE ON memories
  FOR EACH ROW EXECUTE FUNCTION memories_before_update();

-- 3. BEFORE INSERT OR UPDATE: prevent duplicate active non-multi-value records
CREATE OR REPLACE FUNCTION enforce_single_active_per_entity() RETURNS trigger AS $$
DECLARE
  v_allows_multiple boolean;
  v_conflict_count integer;
BEGIN
  SELECT allows_multiple INTO v_allows_multiple
  FROM entity_key_registry WHERE entity_key = NEW.entity_key;

  IF NEW.lifecycle_state = 'active' AND NEW.certainty = 'confirmed' AND NOT v_allows_multiple THEN
    SELECT count(*) INTO v_conflict_count
    FROM memories
    WHERE tenant_id = NEW.tenant_id AND user_id = NEW.user_id AND entity_key = NEW.entity_key
      AND lifecycle_state = 'active' AND certainty = 'confirmed' AND id <> NEW.id;

    IF v_conflict_count > 0 THEN
      RAISE EXCEPTION 'AMM2001: more than one active confirmed record for non-multi-value entity_key %', NEW.entity_key;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_single_active
  BEFORE INSERT OR UPDATE ON memories
  FOR EACH ROW EXECUTE FUNCTION enforce_single_active_per_entity();

-- 4. AFTER INSERT OR UPDATE: append audit event to memory_events
CREATE OR REPLACE FUNCTION log_memory_event() RETURNS trigger AS $$
DECLARE
  v_event_type text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event_type := 'INSERT';
  ELSIF NEW.is_correction AND NOT OLD.is_correction THEN
    v_event_type := 'CORRECT';
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

CREATE TRIGGER trg_log_memory_event
  AFTER INSERT OR UPDATE ON memories
  FOR EACH ROW EXECUTE FUNCTION log_memory_event();

COMMIT;

-- ROLLBACK NOTES (Chapter 34.2, migration 006):
-- Cleanly reversible — triggers are pure behavior, not data:
--   DROP TRIGGER IF EXISTS trg_log_memory_event ON memories;
--   DROP TRIGGER IF EXISTS trg_enforce_single_active ON memories;
--   DROP TRIGGER IF EXISTS trg_memories_before_update ON memories;
--   DROP TRIGGER IF EXISTS trg_memories_before_insert ON memories;
--   DROP FUNCTION IF EXISTS log_memory_event();
--   DROP FUNCTION IF EXISTS enforce_single_active_per_entity();
--   DROP FUNCTION IF EXISTS memories_before_update();
--   DROP FUNCTION IF EXISTS memories_before_insert();
