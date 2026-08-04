-- 013_feedback.sql
-- Adaprio — adds the `feedback` table backing POST /v1/feedback (Ch 10.5).
--
-- Found while building apps/api/src/routes/feedback.ts: Ch 10.5 fully
-- specifies the endpoint's request/response contract, but no table
-- anywhere in migrations 001–012 stores feedback. It isn't `memory_events`
-- (that's system-generated lifecycle audit data, not customer-submitted
-- quality signal) and isn't `memories` (feedback is about a retrieval
-- event, not a fact). This is a straightforward gap, not an architectural
-- tension like the earlier ones — feedback is genuinely new data with
-- nowhere to live yet.

BEGIN;

CREATE TABLE feedback (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  user_id         text not null,
  request_id      text not null,       -- the request_id from the retrieval response being rated
  memory_id       uuid not null references memories(id),
  feedback        text not null check (feedback in ('relevant', 'irrelevant', 'outdated', 'incorrect')),
  note            text,                -- max 500 chars, enforced at the API layer (Ch 10.9), not here
  created_at      timestamptz not null default now()
);

create index idx_feedback_tenant_user on feedback (tenant_id, user_id);
create index idx_feedback_memory_id on feedback (memory_id);
create index idx_feedback_created_at on feedback (created_at);

alter table feedback enable row level security;

create policy tenant_isolation_feedback on feedback
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

COMMIT;

-- ROLLBACK NOTES (migration 013):
-- Contains real customer-submitted data once live — unlike migrations
-- 010–012 (pure behavior), dropping this table destroys feedback history.
-- If rollback is ever needed:
--   DROP TABLE IF EXISTS feedback;
-- Consider archiving (e.g. `feedback_archive` table or an export) before
-- dropping in any environment that has received real traffic.
