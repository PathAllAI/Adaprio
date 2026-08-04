import type { MetricsResponse } from '@adaprio/shared-types';
import { authenticateRequest } from '../lib/auth.js';
import { getOrCreateRequestId, jsonResponse, errorToResponse } from '../lib/http.js';
import type { TenantRepository } from '../repositories/tenant-repository.js';

/**
 * ⚠️ Only 7 of Ch 10.5's 11 `metrics.*` fields are computable from
 * Postgres under the current schema — see migration 014's header comment
 * for the full breakdown. The other 4 (`retrievals_this_period`,
 * `avg_write_latency_ms`, `avg_retrieval_latency_ms`, `memory_found_rate`)
 * only exist in Cloudflare Analytics (Ch 16.2), a separate system this
 * codebase has no adapter for. Returned as `0` below with this comment
 * rather than silently fabricated — treat any `0` in those four fields as
 * "not yet wired up," not "actually zero."
 */

export interface MetricsRouteDeps {
  tenantRepo: TenantRepository;
  apiKeyPepper: string;
}

function currentPeriod(): { label: string; start: string; end: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const label = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
  return { label, start: start.toISOString(), end: end.toISOString() };
}

export async function handleMetrics(request: Request, deps: MetricsRouteDeps): Promise<Response> {
  const requestId = getOrCreateRequestId(request);

  try {
    const tenant = await authenticateRequest(request, {
      tenantRepo: deps.tenantRepo,
      apiKeyPepper: deps.apiKeyPepper,
    });

    const period = currentPeriod();
    const stats = await deps.tenantRepo.getMemoryStats({
      tenantId: tenant.tenantId,
      periodStart: period.start,
      periodEnd: period.end,
    });

    const falsePositiveRate = stats.feedback_total > 0 ? stats.feedback_negative / stats.feedback_total : 0;

    const body: MetricsResponse = {
      tenant_id: tenant.tenantId,
      period: period.label,
      metrics: {
        total_memories: stats.total_memories,
        active_memories: stats.active_memories,
        historical_memories: stats.historical_memories,
        expired_memories: stats.expired_memories,
        deleted_memories: stats.deleted_memories,
        writes_this_period: stats.writes_this_period,
        // Not computable from Postgres — see file header comment.
        retrievals_this_period: 0,
        avg_write_latency_ms: 0,
        avg_retrieval_latency_ms: 0,
        memory_found_rate: 0,
        false_positive_rate_from_feedback: falsePositiveRate,
      },
    };

    return jsonResponse(body, 200, { 'X-Request-ID': requestId });
  } catch (err) {
    return errorToResponse(err, requestId);
  }
}
