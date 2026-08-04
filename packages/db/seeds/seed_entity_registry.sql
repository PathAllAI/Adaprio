-- seed_entity_registry.sql
-- Adaprio — seeds the frozen 60-key entity taxonomy (Chapter 08, Appendix A).
-- GENERATED FILE — do not hand-edit. Regenerate via the taxonomy source
-- table in Handbook Chapter 25 Appendix A if the registry is amended
-- (Chapter 8.6 Entity Key Extension Policy governs additions).
--
-- TTL day mapping used below (Chapter 5.4 / 8.3 — concrete values assumed
-- consistently across the codebase since the handbook specifies bands,
-- not day counts):
--   short          = 14 days
--   medium         = 90 days
--   long           = 365 days
--   until_changed  = NULL (no cron expiry; superseded only by a new value)
--   permanent      = NULL (never expires)
--
-- Idempotent: safe to re-run.

BEGIN;

INSERT INTO entity_key_registry
  (entity_key, domain, description, allows_multiple, allows_versioning, default_ttl_policy, default_ttl_days, sensitivity)
VALUES
  ('identity.name', 'identity', 'Legal or primary name', false, true, 'until_changed', NULL, 'low'),
  ('identity.nickname', 'identity', 'Preferred name or nickname', false, true, 'until_changed', NULL, 'low'),
  ('identity.language', 'identity', 'Preferred language', false, true, 'until_changed', NULL, 'low'),
  ('identity.timezone', 'identity', 'Timezone', false, true, 'until_changed', NULL, 'low'),
  ('identity.birth_date', 'identity', 'Date of birth', false, false, 'permanent', NULL, 'medium'),
  ('identity.cultural_background', 'identity', 'Cultural background, volunteered only', false, false, 'permanent', NULL, 'medium'),
  ('location.country', 'location', 'Country of residence', false, true, 'until_changed', NULL, 'low'),
  ('location.city', 'location', 'City of residence', false, true, 'until_changed', NULL, 'low'),
  ('location.region', 'location', 'State/province/region', false, true, 'until_changed', NULL, 'low'),
  ('location.residence', 'location', 'Current living situation', false, true, 'until_changed', NULL, 'medium'),
  ('location.previous', 'location', 'Previous location', true, false, 'permanent', NULL, 'low'),
  ('employment.organization', 'employment', 'Employer or company', false, true, 'until_changed', NULL, 'low'),
  ('employment.role', 'employment', 'Job title or position', false, true, 'until_changed', NULL, 'low'),
  ('employment.industry', 'employment', 'Industry', false, true, 'until_changed', NULL, 'low'),
  ('employment.status', 'employment', 'Full-time/freelance/student/unemployed', false, true, 'until_changed', NULL, 'low'),
  ('employment.work_style', 'employment', 'Remote/hybrid/office', false, true, 'until_changed', NULL, 'low'),
  ('employment.experience', 'employment', 'Prior work experience', true, false, 'permanent', NULL, 'low'),
  ('education.institution', 'education', 'School or university', false, true, 'until_changed', NULL, 'low'),
  ('education.field', 'education', 'Field of study or major', false, true, 'until_changed', NULL, 'low'),
  ('education.degree', 'education', 'Degree or certificate', false, true, 'until_changed', NULL, 'low'),
  ('education.level', 'education', 'High school/bachelor/graduate', false, true, 'until_changed', NULL, 'low'),
  ('education.status', 'education', 'Studying/graduated/dropped out', false, true, 'until_changed', NULL, 'low'),
  ('skill.technical', 'skill', 'Programming languages, tools, technologies', true, false, 'long', 365, 'low'),
  ('skill.language', 'skill', 'Spoken or written human languages', true, false, 'long', 365, 'low'),
  ('skill.professional', 'skill', 'Leadership, communication, other skills', true, false, 'long', 365, 'low'),
  ('skill.learning', 'skill', 'Skills currently being learned', true, false, 'medium', 90, 'low'),
  ('project.name', 'project', 'Project identity', true, false, 'medium', 90, 'low'),
  ('project.type', 'project', 'Startup/research/personal', true, false, 'medium', 90, 'low'),
  ('project.status', 'project', 'Planning/active/completed', true, false, 'medium', 90, 'low'),
  ('project.goal', 'project', 'Project objective', true, false, 'medium', 90, 'low'),
  ('project.technology', 'project', 'Technologies used in a project', true, false, 'medium', 90, 'low'),
  ('goal.personal', 'goal', 'Personal goal', true, false, 'medium', 90, 'low'),
  ('goal.career', 'goal', 'Career goal', true, false, 'medium', 90, 'low'),
  ('goal.education', 'goal', 'Learning or study goal', true, false, 'medium', 90, 'low'),
  ('goal.financial', 'goal', 'Money-related goal', true, false, 'medium', 90, 'high'),
  ('goal.health', 'goal', 'Health-related goal', true, false, 'medium', 90, 'low'),
  ('goal.timeline', 'goal', 'Deadline or timeframe for a goal', true, false, 'short', 14, 'low'),
  ('preference.general', 'preference', 'General likes or dislikes', true, false, 'long', 365, 'low'),
  ('preference.communication_style', 'preference', 'Short/detailed answers, tone', false, true, 'until_changed', NULL, 'low'),
  ('preference.technology', 'preference', 'Technology preferences', true, false, 'long', 365, 'low'),
  ('preference.food', 'preference', 'Food preferences', true, false, 'long', 365, 'low'),
  ('preference.entertainment', 'preference', 'Movies, music, games', true, false, 'long', 365, 'low'),
  ('preference.learning_style', 'preference', 'How the user prefers to learn', false, true, 'until_changed', NULL, 'low'),
  ('ai.response_style', 'ai', 'How the assistant should respond', false, true, 'until_changed', NULL, 'low'),
  ('ai.workflow_preference', 'ai', 'Preferred assistant workflows', false, true, 'until_changed', NULL, 'low'),
  ('ai.model_preference', 'ai', 'Preferred AI models or tools', false, true, 'until_changed', NULL, 'low'),
  ('relationship.person', 'relationship', 'An important person in the user''s life', true, false, 'long', 365, 'medium'),
  ('relationship.role', 'relationship', 'Friend/colleague/mentor', true, false, 'long', 365, 'low'),
  ('relationship.organization', 'relationship', 'Community or group affiliation', true, false, 'long', 365, 'medium'),
  ('task.current', 'task', 'An open task', true, false, 'short', 14, 'low'),
  ('task.deadline', 'task', 'A task deadline', true, false, 'short', 14, 'low'),
  ('task.status', 'task', 'Pending/completed status', true, false, 'short', 14, 'low'),
  ('event.personal', 'event', 'A personal event', true, false, 'short', 14, 'low'),
  ('event.professional', 'event', 'A work or study event', true, false, 'short', 14, 'low'),
  ('event.deadline', 'event', 'An important date or deadline', true, false, 'short', 14, 'low'),
  ('technology.device', 'technology', 'Laptop, phone, or hardware', true, false, 'long', 365, 'low'),
  ('technology.software', 'technology', 'Apps or software used', true, false, 'long', 365, 'low'),
  ('technology.account', 'technology', 'A service account', true, false, 'long', 365, 'low'),
  ('finance.goal', 'finance', 'A financial objective', true, false, 'medium', 90, 'high'),
  ('health.preference', 'health', 'A lifestyle or health-related preference', true, false, 'medium', 90, 'high')
ON CONFLICT (entity_key) DO UPDATE SET
  domain = EXCLUDED.domain,
  description = EXCLUDED.description,
  allows_multiple = EXCLUDED.allows_multiple,
  allows_versioning = EXCLUDED.allows_versioning,
  default_ttl_policy = EXCLUDED.default_ttl_policy,
  default_ttl_days = EXCLUDED.default_ttl_days,
  sensitivity = EXCLUDED.sensitivity;

COMMIT;

-- Verification: should return 60
-- SELECT count(*) FROM entity_key_registry;
