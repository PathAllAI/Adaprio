import type { ProcessedMemorySummary, QueryIntent, RetrievedMemory } from './memory.js';
import type { MemoryDomain } from './entity-keys.generated.js';

// ─────────────────────────────────────────────────────────────────────────
// POST /v1/memory/process (Ch 10.5)
// ─────────────────────────────────────────────────────────────────────────

export interface ProcessRequest {
  /** required, 1–128 chars, ^[a-zA-Z0-9_-]+$ (Ch 10.9) */
  user_id: string;
  /** optional, same pattern as user_id (Ch 10.9) */
  session_id?: string;
  /** required, 1–4000 chars UTF-8 (Ch 10.9) */
  message: string;
}

export type ProcessStatus = 'processed' | 'no_memory' | 'queued';

export interface ProcessResponse {
  status: ProcessStatus;
  request_id: string;
  memories_created: number;
  memories_updated: number;
  memories: ProcessedMemorySummary[];
  /** Present only when status === 'queued' (Ch 04.8 — provider outage path). */
  message?: string;
  latency_ms: number;
}

// ─────────────────────────────────────────────────────────────────────────
// POST /v1/memory/retrieve (Ch 10.5)
// ─────────────────────────────────────────────────────────────────────────

export interface RetrieveOptions {
  /** 0.0–1.0, default 0.4 (Ch 10.9, 25-C `MIN_CONFIDENCE`) */
  min_confidence?: number;
  /** 1–50, default 10 (Ch 10.9, 25-C `MAX_RETRIEVAL_RESULTS`) */
  max_results?: number;
  include_historical?: boolean;
  /** Each must be a known domain (Ch 07.2) */
  categories?: MemoryDomain[];
}

export interface RetrieveRequest {
  user_id: string;
  /** required, 1–1000 chars (Ch 10.9) */
  query: string;
  options?: RetrieveOptions;
}

export type RetrievalStatus = 'memory_found' | 'memory_not_found';

export interface RetrievalResponse {
  status: RetrievalStatus;
  request_id: string;
  query_intent: QueryIntent;
  memories: RetrievedMemory[];
  latency_ms: number;
  /** True when both rerankers were unavailable and vector-search order was used as-is (Ch 04, failure modes table). */
  degraded?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// POST /v1/feedback (Ch 10.5)
// ─────────────────────────────────────────────────────────────────────────

export type FeedbackValue = 'relevant' | 'irrelevant' | 'outdated' | 'incorrect';

export interface FeedbackRequest {
  request_id: string;
  user_id: string;
  memory_id: string;
  feedback: FeedbackValue;
  /** optional, max 500 chars (Ch 10.9) */
  note?: string;
}

export interface FeedbackResponse {
  status: 'accepted';
  request_id: string;
}

// ─────────────────────────────────────────────────────────────────────────
// GET /v1/health (Ch 10.5)
// ─────────────────────────────────────────────────────────────────────────

export type DependencyStatus = 'ok' | 'degraded' | 'down';

export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  timestamp: string;
  dependencies: {
    database: DependencyStatus;
    llm_primary: DependencyStatus;
    llm_fallback: DependencyStatus;
    embedding: DependencyStatus;
    reranker_primary: DependencyStatus;
    reranker_fallback: DependencyStatus;
  };
}

// ─────────────────────────────────────────────────────────────────────────
// GET /v1/metrics (Ch 10.5)
// ─────────────────────────────────────────────────────────────────────────

export interface MetricsResponse {
  tenant_id: string;
  /** 'YYYY-MM' */
  period: string;
  metrics: {
    total_memories: number;
    active_memories: number;
    historical_memories: number;
    expired_memories: number;
    deleted_memories: number;
    writes_this_period: number;
    retrievals_this_period: number;
    avg_write_latency_ms: number;
    avg_retrieval_latency_ms: number;
    memory_found_rate: number;
    false_positive_rate_from_feedback: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Errors (Ch 10.6, 10.10)
//
// ⚠️ IMPLEMENTATION NOTE — flagging, not silently resolving, an ambiguity:
// the handbook defines TWO separate error code schemes that are never
// explicitly reconciled:
//   1. Ch 10.6 — nine SCREAMING_SNAKE_CASE wire codes, shown verbatim in
//      every JSON example in Ch 10.10. This is what `error.code` actually
//      contains on the wire, and what SDK error classes (Ch 11.2:
//      RateLimitError, InjectionError) match against.
//   2. Ch 28 — thirty-eight granular `AMM####` codes (1xxx engine, 2xxx
//      governance, 3xxx retrieval, 4xxx infra, 5xxx eval, 6xxx api,
//      7xxx db, 8xxx config), each with its own cause/recovery.
// The handbook never states how #2 maps onto #1, or whether AMM#### ever
// appears on the wire at all. The smallest extension consistent with both
// chapters: treat ApiErrorCode (below) as the only value that ever appears
// in an HTTP response body, and InternalErrorCode as a strictly
// server-side classification used in structured logs (Ch 16.1's `event`
// field) and internal metrics — never serialized to the client. Confirm
// before building the SDK's error-mapping logic (Ch 11.2) against this.
// ─────────────────────────────────────────────────────────────────────────

/** Ch 10.6 — the only codes that appear in `error.code` on the wire. */
export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'INJECTION_DETECTED'
  | 'INVALID_USER_ID'
  | 'INVALID_REQUEST'
  | 'PROCESSING_QUEUED'
  | 'SCHEMA_VALIDATION_FAILED'
  | 'DATABASE_ERROR'
  | 'PROVIDER_UNAVAILABLE';

/**
 * Ch 28 — internal engineering catalog. NOT serialized to clients (see the
 * note above) — used for structured logging (Ch 16.1) and internal
 * dashboards/alerts only. Proposed pairing with ApiErrorCode via
 * `INTERNAL_TO_API_ERROR_CODE` below is this package's proposal, not
 * handbook text — confirm before relying on it.
 */
export type InternalErrorCode =
  // 1xxx — Memory Engine
  | 'AMM1001' | 'AMM1002' | 'AMM1003' | 'AMM1004' | 'AMM1005' | 'AMM1006' | 'AMM1007'
  // 2xxx — Governance Engine
  | 'AMM2001' | 'AMM2002' | 'AMM2003' | 'AMM2004' | 'AMM2005' | 'AMM2006'
  // 3xxx — Retrieval Engine
  | 'AMM3001' | 'AMM3002' | 'AMM3003' | 'AMM3004' | 'AMM3005'
  // 4xxx — Infrastructure / Providers
  | 'AMM4001' | 'AMM4002' | 'AMM4003' | 'AMM4004' | 'AMM4005'
  // 5xxx — Evaluation Framework
  | 'AMM5001' | 'AMM5002' | 'AMM5003' | 'AMM5004'
  // 6xxx — API / Auth / Rate Limiting
  | 'AMM6001' | 'AMM6002' | 'AMM6003' | 'AMM6004' | 'AMM6005' | 'AMM6006'
  // 7xxx — Database / Storage
  | 'AMM7001' | 'AMM7002' | 'AMM7003'
  // 8xxx — Configuration
  | 'AMM8001' | 'AMM8002';

/**
 * Proposed (not handbook-specified) mapping from the internal granular
 * catalog to the wire-level code a client actually sees. Every internal
 * code maps to exactly one wire code; several internal codes collapse
 * onto the same wire code by design (e.g. all 4xxx infra failures surface
 * as DATABASE_ERROR or PROVIDER_UNAVAILABLE to the client, regardless of
 * which specific dependency failed).
 */
export const INTERNAL_TO_API_ERROR_CODE: Record<InternalErrorCode, ApiErrorCode> = {
  AMM1001: 'INJECTION_DETECTED',
  AMM1002: 'INVALID_REQUEST', // contains_memory:false is NOT an error in practice — see Ch 28 note; included for completeness only
  AMM1003: 'SCHEMA_VALIDATION_FAILED',
  AMM1004: 'PROCESSING_QUEUED',
  AMM1005: 'SCHEMA_VALIDATION_FAILED',
  AMM1006: 'INVALID_REQUEST',
  AMM1007: 'INVALID_REQUEST',
  AMM2001: 'DATABASE_ERROR',
  AMM2002: 'DATABASE_ERROR',
  AMM2003: 'INVALID_REQUEST',
  AMM2004: 'DATABASE_ERROR',
  AMM2005: 'INVALID_REQUEST',
  AMM2006: 'INVALID_REQUEST',
  AMM3001: 'INVALID_REQUEST', // memory_not_found is a 200, not truly an error — see Ch 28 note
  AMM3002: 'PROVIDER_UNAVAILABLE',
  AMM3003: 'PROVIDER_UNAVAILABLE',
  AMM3004: 'PROVIDER_UNAVAILABLE',
  AMM3005: 'DATABASE_ERROR',
  AMM4001: 'DATABASE_ERROR',
  AMM4002: 'DATABASE_ERROR',
  AMM4003: 'DATABASE_ERROR',
  AMM4004: 'DATABASE_ERROR',
  AMM4005: 'DATABASE_ERROR',
  AMM5001: 'INVALID_REQUEST',
  AMM5002: 'INVALID_REQUEST',
  AMM5003: 'INVALID_REQUEST',
  AMM5004: 'INVALID_REQUEST',
  AMM6001: 'UNAUTHORIZED',
  AMM6002: 'UNAUTHORIZED',
  AMM6003: 'RATE_LIMITED',
  AMM6004: 'INVALID_REQUEST',
  AMM6005: 'INVALID_USER_ID',
  AMM6006: 'INVALID_REQUEST',
  AMM7001: 'DATABASE_ERROR',
  AMM7002: 'DATABASE_ERROR',
  AMM7003: 'DATABASE_ERROR',
  AMM8001: 'DATABASE_ERROR',
  AMM8002: 'DATABASE_ERROR',
};

export interface ApiErrorDetail {
  field?: string;
  issue?: string;
  [key: string]: unknown;
}

/** The exact shape of every non-2xx response body (Ch 10.10). */
export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;
    request_id: string;
    details?: ApiErrorDetail[];
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Rate limiting (Ch 10.7)
// ─────────────────────────────────────────────────────────────────────────

export type RateLimitTier = 'starter' | 'pro' | 'enterprise';

export const RATE_LIMITS: Record<Exclude<RateLimitTier, 'enterprise'>, { writesPerMin: number; retrievalsPerMin: number }> = {
  starter: { writesPerMin: 60, retrievalsPerMin: 120 },
  pro: { writesPerMin: 300, retrievalsPerMin: 600 },
};

// NOTE: MemoryDomain is imported above for use in this file's own type
// signatures but deliberately NOT re-exported here — see the equivalent
// note in memory.ts. The barrel (index.ts) is the single place all shared
// types are aggregated; re-exporting them from more than one module would
// create an ambiguous export.
