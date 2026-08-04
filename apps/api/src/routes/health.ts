import type { DependencyStatus, HealthResponse } from '@adaprio/shared-types';
import { jsonResponse } from '../lib/http.js';
import type { DatabaseAdapter, EmbeddingAdapter, LLMAdapter, RerankerAdapter } from '@adaprio/shared-types';

/**
 * ⚠️ DELIBERATE DEVIATION from Ch 10.1's blanket "All requests require
 * Authorization." A health/liveness endpoint that itself requires a
 * customer API key defeats its purpose for infrastructure-level monitoring
 * (load balancers, uptime checkers, Cloudflare's own health checks don't
 * carry tenant credentials). This handler is intentionally unauthenticated
 * — confirm this is acceptable, or specify how infra monitoring is meant
 * to reach an authenticated health check if not.
 */

export interface HealthRouteDeps {
  database: DatabaseAdapter;
  embedding: EmbeddingAdapter;
  llmPrimary: LLMAdapter;
  llmFallback: LLMAdapter;
  rerankerPrimary: RerankerAdapter;
  rerankerFallback: RerankerAdapter;
  version: string;
}

async function pingToStatus(ping: () => Promise<boolean>): Promise<DependencyStatus> {
  try {
    return (await ping()) ? 'ok' : 'down';
  } catch {
    return 'down';
  }
}

export async function handleHealth(deps: HealthRouteDeps): Promise<Response> {
  const [database, llmPrimary, llmFallback, embedding, rerankerPrimary, rerankerFallback] = await Promise.all([
    pingToStatus(() => deps.database.ping()),
    pingToStatus(() => deps.llmPrimary.ping()),
    pingToStatus(() => deps.llmFallback.ping()),
    pingToStatus(() => deps.embedding.ping()),
    pingToStatus(() => deps.rerankerPrimary.ping()),
    pingToStatus(() => deps.rerankerFallback.ping()),
  ]);

  const dependencies = { database, llm_primary: llmPrimary, llm_fallback: llmFallback, embedding, reranker_primary: rerankerPrimary, reranker_fallback: rerankerFallback };

  // Overall status: 'ok' only if every dependency with no fallback (database,
  // embedding) is ok, AND at least one of each fallback pair (llm, reranker)
  // is ok. A down primary with a working fallback is 'degraded', not 'ok' —
  // customers should be able to see the system is running on a backup path.
  const criticalDown = database === 'down' || embedding === 'down';
  const llmFullyDown = llmPrimary === 'down' && llmFallback === 'down';
  const rerankerFullyDown = rerankerPrimary === 'down' && rerankerFallback === 'down';
  const anyPrimaryDown = llmPrimary === 'down' || rerankerPrimary === 'down';

  const status: HealthResponse['status'] =
    criticalDown || llmFullyDown || rerankerFullyDown ? 'degraded' : anyPrimaryDown ? 'degraded' : 'ok';

  const body: HealthResponse = {
    status,
    version: deps.version,
    timestamp: new Date().toISOString(),
    dependencies,
  };

  // Ch 10.5 doesn't specify a non-200 status for a degraded/down health
  // response. Standard practice (and consistent with most uptime-monitor
  // conventions) is 200 for 'ok', 503 for anything the caller should treat
  // as "don't route traffic here" — used here since Ch 10.5 leaves it open.
  return jsonResponse(body, status === 'ok' ? 200 : 503);
}
