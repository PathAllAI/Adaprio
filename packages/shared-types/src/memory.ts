import type { EntityKey } from './entity-keys.generated.js';

// NOTE: EntityKey is used below but deliberately NOT re-exported from this
// file — index.ts re-exports entity-keys.generated.ts directly, and
// re-exporting the same name here too would create a duplicate/ambiguous
// export in the barrel. Import EntityKey/MemoryDomain from
// '@adaprio/shared-types' (the barrel) or directly from
// './entity-keys.generated.js', never from './memory.js'.

/**
 * DB-backed certainty — matches the `certainty_level` Postgres enum
 * (migration 001) EXACTLY: only two values. Use this type for anything
 * that reads from or writes to the `memories` table, or that calls a
 * governance-repository RPC function (`p_certainty certainty_level`).
 *
 * ⚠️ This is narrower than what Ch 30.1's extraction prompt asks the LLM
 * to return (`confirmed | tentative | hypothetical`) — see
 * `ExtractionCertainty` below and the reconciliation note there. Passing
 * a `'hypothetical'` value to anything typed `Certainty` is a compile
 * error by design, because passing it to the database is a runtime
 * error (Postgres 22P02, invalid enum input).
 */
export type Certainty = 'confirmed' | 'tentative';

/** Matches the Postgres `lifecycle_state` enum (migration 001). Ch 06.1, 27.12. */
export type LifecycleState = 'active' | 'historical' | 'superseded' | 'expired' | 'deleted';

/** Matches the Postgres `ttl_policy` enum (migration 001). Ch 05.4, 09.2. */
export type TtlPolicy = 'permanent' | 'until_changed' | 'short' | 'medium' | 'long';

/**
 * Matches what `log_memory_event()` (migration 006) actually produces —
 * NOT the CREATE/UPDATE/ARCHIVE/RESTORE/DELETE/CORRECT set described in
 * handbook prose (Ch 06, 09.5), which drifted from the executable trigger.
 * Source of truth here is the SQL, discovered while building the
 * repository layer against it. There is no `memory_event_type` Postgres
 * enum — `event_type` is plain `text` in migration 004.
 *
 * ⚠️ 'RESTORE' is listed in migration 004's comment and in the Ch 06.1 /
 * 27.12 lifecycle state diagrams (historical/expired → active), but no
 * branch in `log_memory_event()` ever assigns it — a manual restore
 * (dashboard or future API) currently falls through to the trigger's final
 * `ELSE 'UPDATE'` branch. This is a real gap in migration 006, not a typing
 * error here: flag it against that migration before the dashboard
 * version-history view (Ch 13) ships, since it needs to distinguish a
 * restore from an ordinary field update.
 */
export type MemoryEventType = 'INSERT' | 'ARCHIVE' | 'EXPIRE' | 'DELETE' | 'CORRECT' | 'REINFORCE' | 'UPDATE';

/** Matches the Postgres `sensitivity_level` enum (migration 001/002). Ch 08.4. */
export type SensitivityLevel = 'low' | 'medium' | 'high';

// ─────────────────────────────────────────────────────────────────────────
// Write path — Memory Intelligence LLM extraction schema (Ch 04.3, 30.1)
// ─────────────────────────────────────────────────────────────────────────

/**
 * The certainty domain the LLM is actually prompted to return (Ch 30.1) —
 * wider than the DB-backed `Certainty` type above by exactly one value:
 * `hypothetical`. See `resolveCertaintyForStorage` below for the proposed
 * (not handbook-specified) reconciliation between this and `Certainty`.
 */
export type ExtractionCertainty = Certainty | 'hypothetical';

/**
 * A single memory object as returned by the Memory Intelligence LLM
 * (Groq Qwen 3.6 27B primary, HF Qwen3-8B fallback) in one inference call.
 * This is the exact shape the JSON schema validator (Ch 04.4) checks
 * against — any change here requires a corresponding prompt version bump
 * (Ch 30.3, Ch 33.4) and new eval dataset cases.
 */
export interface ExtractedMemory {
  entity_key: EntityKey;
  value: string;
  memory_text: string;
  certainty: ExtractionCertainty;
  /** 0.0–1.0. Clamped server-side to [0.05, 1.0] by the Governance Engine (Ch 05.3). */
  importance: number;
  ttl_policy: TtlPolicy;
  /** True if this fact likely displaces a prior known fact for the same entity_key. */
  contradiction: boolean;
  /** True ONLY when something stopped being true with no replacement (Rule 3, Ch 06.2). */
  is_negation: boolean;
  /** True ONLY when a prior fact was NEVER true (Rule 4, Ch 06.2). Higher priority than is_negation. */
  is_correction: boolean;
  entities: Record<string, string>;
}

/** Raw output of the Memory Intelligence LLM for one message (Ch 04.3). */
export interface LLMResponse {
  contains_memory: boolean;
  memories: ExtractedMemory[];
}

/**
 * ⚠️ PROPOSED, NOT HANDBOOK-SPECIFIED. Discovered while building the
 * repository layer: the `certainty_level` Postgres enum (migration 001)
 * only accepts `confirmed`/`tentative` — inserting `hypothetical` fails
 * with Postgres error 22P02. No chapter states what should happen to a
 * `hypothetical` extraction before storage. The smallest extension
 * consistent with the prompt's own framing (Ch 30.1: hypothetical is
 * explicitly the *weakest* certainty tier, below tentative) is: do not
 * store it as a memory at all. Confirm before wiring this into
 * src/engine/governance.ts — an alternative (coerce to 'tentative' with a
 * shortened TTL instead of dropping) is equally defensible and was not
 * chosen here only because dropping is the more conservative default.
 */
export function resolveCertaintyForStorage(certainty: ExtractionCertainty): Certainty | null {
  return certainty === 'hypothetical' ? null : certainty;
}

// ─────────────────────────────────────────────────────────────────────────
// Read path — retrieval response shapes (Ch 07.6, 10.5)
// ─────────────────────────────────────────────────────────────────────────

export interface Explainability {
  ranked_by: 'reranker' | 'vector_similarity';
  reranker_score: number;
  freshness_score: number;
  reinforcement_score: number;
  category_match: boolean;
}

/** A memory as returned to the caller from POST /v1/memory/retrieve (Ch 10.5). */
export interface RetrievedMemory {
  id: string;
  entity_key: EntityKey;
  value: string;
  memory_text: string;
  certainty: Certainty;
  lifecycle_state: LifecycleState;
  /** Final blended confidence score (Ch 07.5 formula) — distinct from LLM-assigned `importance`. */
  confidence: number;
  importance_score: number;
  /** ISO 8601. */
  last_confirmed_at: string;
  retrieval_count: number;
  explainability: Explainability;
}

export type QueryIntent = 'current_state' | 'historical' | 'open';

// ─────────────────────────────────────────────────────────────────────────
// Write path — response summary shapes (Ch 10.5)
// ─────────────────────────────────────────────────────────────────────────

/** One memory as summarized in a successful POST /v1/memory/process response. */
export interface ProcessedMemorySummary {
  id: string;
  entity_key: EntityKey;
  value: string;
  certainty: Certainty;
  lifecycle_state: LifecycleState;
  /** Count of prior versions this write superseded (0 for a brand-new entity_key). */
  superseded_count: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Audit trail (Ch 06, 09.5, Ch 13 dashboard version-history view)
// ─────────────────────────────────────────────────────────────────────────

export interface MemoryEvent {
  id: string;
  tenant_id: string;
  user_id: string;
  /** NOT NULL in migration 004 — every event always belongs to exactly one memory row. */
  memory_id: string;
  entity_key: EntityKey;
  event_type: MemoryEventType;
  previous_state: Record<string, unknown> | null;
  new_state: Record<string, unknown> | null;
  created_at: string;
}
