import type { EmbeddingAdapter, LifecycleState, MemoryDomain, RerankerAdapter, RetrievalStatus, RetrievedMemory } from '@adaprio/shared-types';
import { ruleFilter } from '../engine/rule-filter.js';
import { classifyIntent, detectCategories } from '../engine/intent.js';
import { applyConfidenceScoring } from '../engine/confidence.js';
import type { MemoryRepository } from '../repositories/memory-repository.js';
import { injectionDetected } from '../lib/errors.js';

const VECTOR_SEARCH_CANDIDATE_LIMIT = 20;

export interface ReadPipelineDeps {
  embedding: EmbeddingAdapter;
  reranker: RerankerAdapter;
  memoryRepo: MemoryRepository;
  /** Ch 10.9 default 0.4 — from tenant config, not hardcoded here. */
  defaultMinConfidence: number;
  /** Ch 10.9 default 10. */
  defaultMaxResults: number;
}

export interface ReadPipelineParams {
  tenantId: string;
  userId: string;
  query: string;
  options?: {
    minConfidence?: number;
    maxResults?: number;
    includeHistorical?: boolean;
    categories?: MemoryDomain[];
  };
}

export interface ReadPipelineResult {
  status: RetrievalStatus;
  query_intent: ReturnType<typeof classifyIntent>['intent'];
  memories: RetrievedMemory[];
  degraded?: boolean;
}

/**
 * Runs the complete read pipeline for one query. Throws `ApiError`
 * (INJECTION_DETECTED) for a rejected query. A `forget`-classified query
 * is deliberately treated as an ordinary query here, not acted on — Ch
 * 04.8 explicitly scopes the rule filter to "injection check only — no
 * forget on read path."
 */
export async function runReadPipeline(deps: ReadPipelineDeps, params: ReadPipelineParams): Promise<ReadPipelineResult> {
  const { tenantId, userId, query } = params;

  // ── Stage 1: Rule filter — injection check only (Ch 04.8) ──────────────
  const filterResult = ruleFilter(query);
  if (filterResult.action === 'reject') {
    throw injectionDetected();
  }
  // `filterResult.action === 'forget'` is intentionally ignored here.

  // ── Stage 2: Intent classification + temporal lifecycle filter (Ch 07.1) ─
  const { intent, lifecycleFilter: intentLifecycleFilter } = classifyIntent(query);
  const lifecycleFilter: LifecycleState[] = params.options?.includeHistorical
    ? ['active', 'historical', 'superseded']
    : intentLifecycleFilter;

  // ── Stage 3: Category detection (Ch 07.2) ───────────────────────────────
  const detectedCategories = params.options?.categories?.length
    ? params.options.categories
    : detectCategories(query);

  // ── Stage 4: Embed the query (Ch 07.3 input) ────────────────────────────
  let queryVector: number[];
  try {
    const [vec] = await deps.embedding.embed([query]);
    queryVector = vec;
  } catch {
    // AMM3003 EmbeddingQueryFailed (Ch 28) — one retry before giving up.
    // Unlike the write path, there is no graceful null-embedding fallback
    // here: a retrieval query with no vector cannot run Ch 07.3's search
    // at all. A metadata-only fallback (AMM3004's degraded path) would
    // require category filters to already be confidently detected —
    // not attempted here to keep this stage's failure mode simple and
    // loud rather than silently returning low-quality results.
    const [vec] = await deps.embedding.embed([query]);
    queryVector = vec;
  }

  // ── Stage 5: Vector search (Ch 07.3) ────────────────────────────────────
  const candidates = await deps.memoryRepo.vectorSearch({
    tenantId,
    userId,
    queryVector,
    lifecycleFilter,
    categoryFilter: detectedCategories.length > 0 ? detectedCategories : undefined,
    limit: VECTOR_SEARCH_CANDIDATE_LIMIT,
  });

  if (candidates.length === 0) {
    return { status: 'memory_not_found', query_intent: intent, memories: [] };
  }

  // ── Stage 6: Reranking, with vector-similarity fallback (Ch 07.4) ──────
  let rerankerScores: number[] | null = null;
  let degraded = false;
  try {
    rerankerScores = await deps.reranker.rerank(query, candidates.map((c) => c.memoryText));
  } catch {
    // Both primary and fallback reranker exhausted (AMM3002) — the
    // reranker adapter passed in is itself expected to already be a
    // fallback chain (Ch 31.6), so reaching here means total reranker
    // unavailability, not just the primary being down.
    degraded = true;
  }

  // ── Stage 7: Confidence scoring + threshold filter (Ch 07.5, 07.6) ─────
  const minConfidence = params.options?.minConfidence ?? deps.defaultMinConfidence;
  const maxResults = params.options?.maxResults ?? deps.defaultMaxResults;

  const scored = applyConfidenceScoring({
    candidates,
    rerankerScores,
    detectedCategories,
    minConfidence,
    intent,
  }).slice(0, maxResults);

  // ── Stage 8: Fire-and-forget reinforcement (Ch 06.4) ────────────────────
  // Deliberately not awaited — must never add latency to the response.
  if (scored.length > 0) {
    void deps.memoryRepo.reinforceRetrieved(scored.map((m) => m.id)).catch(() => {
      // Reinforcement failure is non-critical by design (Ch 06.4) — the
      // route layer's logger should still record this; left as a no-op
      // here since this module has no logger dependency of its own.
    });
  }

  return {
    status: scored.length > 0 ? 'memory_found' : 'memory_not_found',
    query_intent: intent,
    memories: scored,
    ...(degraded ? { degraded: true } : {}),
  };
}
