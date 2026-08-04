-- 014_tenant_memory_stats.sql
-- Adaprio — adds `get_tenant_memory_stats`, needed for GET /v1/metrics
-- (Ch 10.5).
--
-- Found while building apps/api/src/routes/metrics.ts. Ch 10.5's
-- MetricsResponse has 11 fields; only SOME of them are computable from
-- data that exists anywhere in the current schema:
--
--   COMPUTABLE from `memories` (this function):
--     total_memories, active_memories, historical_memories,
--     expired_memories, deleted_memories
--
--   COMPUTABLE from `memory_events` (this function, CREATE-type events
--   as a proxy for write volume) and `feedback` (migration 013):
--     writes_this_period, false_positive_rate_from_feedback
--     (= (irrelevant + incorrect) / total feedback rows in the period)
--
--   NOT COMPUTABLE from Postgres at all with the current architecture:
--     retrievals_this_period, avg_write_latency_ms, avg_retrieval_latency_ms,
--     memory_found_rate
--   These only exist as Cloudflare Analytics metrics (Ch 16.2:
--   `amm.retrieval.duration_ms`, etc.) — a separate system this codebase
--   has no adapter for. routes/metrics.ts returns these as `0` with a
--   loud comment rather than silently fabricating plausible-looking
--   numbers. Closing this gap for real needs either a Cloudflare
--   Analytics Engine query adapter, or a new Postgres request-log table
--   populated on every write/retrieve call — a bigger addition than this
--   migration makes unprompted.

BEGIN;

CREATE OR REPLACE FUNCTION get_tenant_memory_stats(
  p_tenant_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz
)
RETURNS TABLE (
  total_memories bigint,
  active_memories bigint,
  historical_memories bigint,
  expired_memories bigint,
  deleted_memories bigint,
  writes_this_period bigint,
  feedback_total bigint,
  feedback_negative bigint
) AS $$
BEGIN
  RETURN QUERY
    SELECT
      (SELECT count(*) FROM memories WHERE tenant_id = p_tenant_id),
      (SELECT count(*) FROM memories WHERE tenant_id = p_tenant_id AND lifecycle_state = 'active'),
      (SELECT count(*) FROM memories WHERE tenant_id = p_tenant_id AND lifecycle_state = 'historical'),
      (SELECT count(*) FROM memories WHERE tenant_id = p_tenant_id AND lifecycle_state = 'expired'),
      (SELECT count(*) FROM memories WHERE tenant_id = p_tenant_id AND lifecycle_state = 'deleted'),
      (SELECT count(*) FROM memory_events
        WHERE tenant_id = p_tenant_id AND event_type = 'INSERT'
          AND created_at >= p_period_start AND created_at < p_period_end),
      (SELECT count(*) FROM feedback
        WHERE tenant_id = p_tenant_id
          AND created_at >= p_period_start AND created_at < p_period_end),
      (SELECT count(*) FROM feedback
        WHERE tenant_id = p_tenant_id AND feedback IN ('irrelevant', 'incorrect')
          AND created_at >= p_period_start AND created_at < p_period_end);
END;
$$ LANGUAGE plpgsql STABLE;

COMMIT;

-- ROLLBACK NOTES (migration 014):
-- Pure read-path behavior, no data — safe to drop at any time:
--   DROP FUNCTION IF EXISTS get_tenant_memory_stats(uuid, timestamptz, timestamptz);
-- Depends on the `feedback` table (migration 013) — apply that first.
