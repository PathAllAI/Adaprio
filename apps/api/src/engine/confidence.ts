/**
 * Confidence scorer (Ch 07.5).
 *
 * Applies the handbook's blended confidence formula to each candidate
 * memory after reranking, then filters out anything below the configured
 * threshold. Pure computation — no I/O, no state.
 *
 * Formula (Ch 7.5, verbatim):
 *   confidence = 0.5 × reranker_score
 *              + 0.2 × importance_score
 *              + 0.15 × freshness_score
 *              + 0.15 × reinforcement_score
 *
 * Where:
 *   freshness_score    = exp(-days_since_last_confirmed / 365)
 *   reinforcement_score = min(1.0, retrieval_count / 20)
 */

import type { CandidateMemory, Explainability, QueryIntent, RetrievedMemory } from '@adaprio/shared-types';

// ─────────────────────────────────────────────────────────────────────────
// Sub-score helpers (Ch 7.5)
// ─────────────────────────────────────────────────────────────────────────

const FRESHNESS_HALFLIFE_DAYS = 365;
const REINFORCEMENT_SATURATION = 20;

function freshnessScore(lastConfirmedAt: string): number {
  const daysSince = (Date.now() - new Date(lastConfirmedAt).getTime()) / (1000 * 60 * 60 * 24);
  return Math.exp(-daysSince / FRESHNESS_HALFLIFE_DAYS);
}

function reinforcementScore(retrievalCount: number): number {
  return Math.min(1.0, retrievalCount / REINFORCEMENT_SATURATION);
}

// ─────────────────────────────────────────────────────────────────────────
// Per-memory scoring
// ─────────────────────────────────────────────────────────────────────────

export interface ScoredCandidate {
  candidate: CandidateMemory;
  confidence: number;
  explainability: Explainability;
}

/**
 * Scores one candidate using the handbook formula. `rerankerScore` is
 * the output from the reranker; pass `candidate.similarityScore` when the
 * reranker was unavailable (Ch 7.4 fallback: "use vector similarity score
 * as proxy") and set `rankedBy = 'vector_similarity'`.
 */
export function scoreCandidate(
  candidate: CandidateMemory,
  rerankerScore: number,
  rankedBy: Explainability['ranked_by'],
  categoryMatch: boolean
): ScoredCandidate {
  const freshness = freshnessScore(candidate.validFrom);
  const reinforcement = reinforcementScore(candidate.retrievalCount);
  const importance = parseFloat(candidate.importanceScore as unknown as string);

  const confidence =
    0.50 * rerankerScore +
    0.20 * importance +
    0.15 * freshness +
    0.15 * reinforcement;

  const explainability: Explainability = {
    ranked_by: rankedBy,
    reranker_score: rerankerScore,
    freshness_score: freshness,
    reinforcement_score: reinforcement,
    category_match: categoryMatch,
  };

  return { candidate, confidence, explainability };
}

// ─────────────────────────────────────────────────────────────────────────
// Score + filter + shape pipeline (Ch 7.5, 7.6)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Scores all candidates, filters below `minConfidence`, and shapes them
 * into the `RetrievedMemory` response shape (Ch 7.6 / 10.5).
 *
 * `rerankerScores`: parallel array from the reranker, same length and order
 * as `candidates`. Pass null when the reranker was entirely unavailable —
 * each candidate's `similarityScore` is used as a proxy instead.
 */
export function applyConfidenceScoring(params: {
  candidates: CandidateMemory[];
  rerankerScores: number[] | null;
  detectedCategories: string[];
  minConfidence: number;
  intent: QueryIntent;
}): RetrievedMemory[] {
  const { candidates, rerankerScores, detectedCategories, minConfidence } = params;
  const rankedBy: Explainability['ranked_by'] = rerankerScores ? 'reranker' : 'vector_similarity';
  const categorySet = new Set(detectedCategories);

  const scored: ScoredCandidate[] = candidates.map((candidate, i) => {
    const rerankerScore = rerankerScores
      ? rerankerScores[i]
      : (candidate.similarityScore ?? 0);

    const categoryMatch = categorySet.size === 0 || categorySet.has(candidate.entityKey.split('.')[0]);

    return scoreCandidate(candidate, rerankerScore, rankedBy, categoryMatch);
  });

  return scored
    .filter((s) => s.confidence >= minConfidence)
    .sort((a, b) => b.confidence - a.confidence)
    .map(({ candidate, confidence, explainability }) => ({
      id: candidate.id,
      entity_key: candidate.entityKey,
      value: candidate.value,
      memory_text: candidate.memoryText,
      certainty: candidate.certainty as RetrievedMemory['certainty'],
      lifecycle_state: candidate.lifecycleState,
      confidence: parseFloat(confidence.toFixed(4)),
      importance_score: parseFloat(String(candidate.importanceScore)),
      last_confirmed_at: candidate.validFrom,
      retrieval_count: candidate.retrievalCount,
      explainability,
    }));
}
