import type { LLMResponse, LifecycleState } from './memory.js';
import type { EntityKey, MemoryDomain } from './entity-keys.generated.js';

// ─────────────────────────────────────────────────────────────────────────
// LLM Adapter (Ch 31.2)
// ─────────────────────────────────────────────────────────────────────────

export interface LLMAdapter {
  readonly name: string;

  /**
   * Run a single structured extraction inference. Must return a validated
   * LLMResponse or throw LLMAdapterError — never a partially-shaped object.
   */
  extract(
    systemPrompt: string,
    userMessage: string,
    options?: { timeoutMs?: number }
  ): Promise<LLMResponse>;

  ping(): Promise<boolean>;
}

export type LLMAdapterErrorCode = 'TIMEOUT' | 'RATE_LIMIT' | 'SERVER_ERROR' | 'SCHEMA_INVALID' | 'NETWORK';

export class LLMAdapterError extends Error {
  constructor(
    public readonly code: LLMAdapterErrorCode,
    message: string,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = 'LLMAdapterError';
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Embedding Adapter (Ch 31.2, second occurrence — embedding, not LLM)
// ─────────────────────────────────────────────────────────────────────────

export interface EmbeddingAdapter {
  readonly name: string;
  /** Must be 1024 for the MVP schema (Ch 09.3 — `vector(1024)`, Qwen3-Embedding-0.6B native dim). */
  readonly dimension: number;

  embed(texts: string[]): Promise<number[][]>;
  ping(): Promise<boolean>;
}

// ─────────────────────────────────────────────────────────────────────────
// Reranker Adapter (Ch 31.3)
// ─────────────────────────────────────────────────────────────────────────

export interface RerankerAdapter {
  readonly name: string;

  /** Returns scores in [0,1], same order as the input `documents`. */
  rerank(
    query: string,
    documents: string[],
    options?: { timeoutMs?: number }
  ): Promise<number[]>;

  ping(): Promise<boolean>;
}

// ─────────────────────────────────────────────────────────────────────────
// Database Adapter (Ch 31.4) — RECONCILED with Ch 9.9 (v1.2.0)
//
// ⚠️ IMPLEMENTATION NOTE: the original Ch 31.4 interface included a generic
// `executeGovernanceTransaction(ops: GovernanceOperation[])` method. Ch 9.9
// (added in v1.2.0) instead specifies that each conflict rule is a *named*
// Postgres function (`apply_direct_replacement`, `apply_departure`, etc.,
// see packages/db/migrations/007_governance_functions.sql) called via
// `supabase.rpc(fnName, params)` from domain-named repository methods
// (`governance-repository.ts`) — not a generic ops-array abstraction.
// These two designs are in tension: 9.9 is more detailed, more recent, and
// shows working SQL, so this file follows 9.9 and treats DatabaseAdapter as
// the thin, generic Supabase wrapper that the repository layer (which
// lives in apps/api/src/repositories/, NOT in this package — see Ch 33.1.2,
// shared-types owns API contracts, not internal data-access interfaces)
// is built on top of. The generic `executeGovernanceTransaction` method
// and `GovernanceOperation` type are DROPPED here as superseded. Confirm
// this reconciliation before implementing apps/api/src/repositories/.
// ─────────────────────────────────────────────────────────────────────────

export interface VectorSearchParams {
  tenantId: string;
  userId: string;
  queryVector: number[];
  lifecycleFilter: LifecycleState[];
  categoryFilter?: MemoryDomain[];
  limit: number;
}

export interface MetadataSearchParams {
  tenantId: string;
  userId: string;
  lifecycleFilter: LifecycleState[];
  categoryFilter?: MemoryDomain[];
  entityKey?: EntityKey;
  limit: number;
}

export interface CandidateMemory {
  id: string;
  entityKey: EntityKey;
  value: string;
  memoryText: string;
  certainty: string;
  importanceScore: number;
  lifecycleState: LifecycleState;
  validFrom: string;
  validUntil: string | null;
  retrievalCount: number;
  lastAccessed: string | null;
  reinforcementScore: number;
  /** Present only for vector search results; absent for metadata-only search (Ch 07.3 vs AMM3004 fallback). */
  similarityScore?: number;
}

export interface DatabaseAdapter {
  /**
   * Generic escape hatch onto a named Postgres function (migration 007).
   * This is the ONLY way governance writes happen — see reconciliation
   * note above. `apps/api/src/repositories/governance-repository.ts` wraps
   * each named function with a domain-meaningful method name; nothing
   * outside the repository layer calls `rpc()` directly (Ch 9.9).
   */
  rpc<T>(functionName: string, params: Record<string, unknown>): Promise<T>;

  vectorSearch(params: VectorSearchParams): Promise<CandidateMemory[]>;
  metadataSearch(params: MetadataSearchParams): Promise<CandidateMemory[]>;
  updateReinforcement(memoryIds: string[]): Promise<void>;

  /**
   * ⚠️ ADDED HERE, not originally in Ch 31.4 — discovered as a genuine gap
   * while building event-repository.ts and pending-repository.ts. Neither
   * `memory_events` nor `pending_memory_events` has any governance RPC
   * function (migration 007 covers only `memories`), and Ch 9.9 explicitly
   * permits plain `.from(...)` reads/writes for operations with "no
   * atomicity requirement" — audit history reads and queue enqueue/update
   * are exactly that case. These three generic methods are this package's
   * proposed minimal surface for that; a concrete `SupabaseAdapter` would
   * implement each as a thin `.from(table)...` call. Filters are always
   * exact-match equality (`WHERE col = value` ANDed together) — anything
   * needing OR conditions, ranges, or `ILIKE` stays behind a named `rpc()`
   * function instead, consistent with the "no inline SQL outside
   * repositories/migrations" rule.
   */
  select<T>(params: {
    table: string;
    filters: Record<string, unknown>;
    orderBy?: { column: string; ascending?: boolean };
    limit?: number;
  }): Promise<T[]>;

  insert<T>(params: { table: string; values: Record<string, unknown> }): Promise<T>;

  update<T>(params: {
    table: string;
    filters: Record<string, unknown>;
    values: Record<string, unknown>;
  }): Promise<T[]>;

  ping(): Promise<boolean>;
}
