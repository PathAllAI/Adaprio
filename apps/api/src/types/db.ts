import type { Certainty, EntityKey, LifecycleState, MemoryEventType, TtlPolicy } from '@adaprio/shared-types';

/**
 * Full row shape of the `memories` table (migration 003) — snake_case,
 * matching Postgres exactly. This is what `supabase.rpc('apply_*', ...)`
 * actually returns for any function declared `RETURNS memories`. Distinct
 * from `CandidateMemory` in shared-types (which is a narrower, camelCase
 * shape purpose-built for retrieval results) — this type is for the
 * repository layer's internal use, never sent to a customer as-is.
 */
export interface MemoryRow {
  id: string;
  tenant_id: string;
  user_id: string;
  entity_key: EntityKey;
  category: string | null;

  value: string;
  memory_text: string;

  certainty: Certainty;
  lifecycle_state: LifecycleState;

  is_negation: boolean;
  is_correction: boolean;
  archive_reason: string | null;
  previous_version_id: string | null;
  superseded_by: string | null;
  version: number;

  confidence: string; // numeric(4,3) comes back as a string from postgres-js/PostgREST
  importance_score: string;
  reinforcement_score: string;
  retrieval_count: number;

  ttl_policy: TtlPolicy | null;
  expires_at: string | null;
  valid_until: string | null;
  last_accessed: string | null;
  last_confirmed_at: string;

  /** pgvector comes back as a string like "[0.01,-0.02,...]" via PostgREST, not a number[]. */
  embedding: string | null;

  lock_version: number;

  created_at: string;
  updated_at: string;
}

/** Full row shape of `memory_events` (migration 004). */
export interface MemoryEventRow {
  id: string;
  tenant_id: string;
  user_id: string;
  memory_id: string;
  entity_key: EntityKey;
  event_type: MemoryEventType;
  previous_state: Record<string, unknown> | null;
  new_state: Record<string, unknown> | null;
  created_at: string;
}

/** Full row shape of `pending_memory_events` (migration 005). */
export type PendingEventStatus = 'pending' | 'processing' | 'processed' | 'failed';

export interface PendingEventRow {
  id: string;
  tenant_id: string;
  user_id: string;
  session_id: string | null;
  message: string;
  status: PendingEventStatus;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}
