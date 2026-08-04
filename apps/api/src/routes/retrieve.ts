import type { RetrievalResponse } from '@adaprio/shared-types';
import { authenticateRequest } from '../lib/auth.js';
import { checkRateLimit } from '../lib/rate-limit.js';
import { getOrCreateRequestId, jsonResponse, rateLimitHeaders, errorToResponse } from '../lib/http.js';
import { invalidRequest, rateLimited } from '../lib/errors.js';
import { RetrieveRequestSchema, zodIssuesToDetails } from '../lib/request-schemas.js';
import { runReadPipeline } from '../pipeline/read.js';
import type { ReadPipelineDeps } from '../pipeline/read.js';
import type { TenantRepository } from '../repositories/tenant-repository.js';
import type { KVNamespaceLike } from '../lib/kv-binding.js';

export interface RetrieveRouteDeps {
  tenantRepo: TenantRepository;
  rateLimitKv: KVNamespaceLike;
  apiKeyPepper: string;
  readDeps: ReadPipelineDeps;
}

export async function handleRetrieve(request: Request, deps: RetrieveRouteDeps): Promise<Response> {
  const requestId = getOrCreateRequestId(request);
  const startedAt = Date.now();
  let rlHeaders: Record<string, string> = {};

  try {
    const tenant = await authenticateRequest(request, {
      tenantRepo: deps.tenantRepo,
      apiKeyPepper: deps.apiKeyPepper,
    });

    const rateLimit = await checkRateLimit(deps.rateLimitKv, tenant.tenantId, 'retrieve', tenant.retrievalsPerMin);
    rlHeaders = rateLimitHeaders(rateLimit);
    if (!rateLimit.allowed) {
      throw rateLimited(
        'Retrieval rate limit exceeded for this tenant.',
        rateLimit.resetAt - Math.floor(Date.now() / 1000)
      );
    }

    const rawBody = await request.json().catch(() => null);
    const parsed = RetrieveRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw invalidRequest('One or more fields failed validation.', zodIssuesToDetails(parsed.error.issues));
    }

    const result = await runReadPipeline(deps.readDeps, {
      tenantId: tenant.tenantId,
      userId: parsed.data.user_id,
      query: parsed.data.query,
      options: parsed.data.options
        ? {
            minConfidence: parsed.data.options.min_confidence,
            maxResults: parsed.data.options.max_results,
            includeHistorical: parsed.data.options.include_historical,
            categories: parsed.data.options.categories,
          }
        : undefined,
    });

    const body: RetrievalResponse = {
      status: result.status,
      request_id: requestId,
      query_intent: result.query_intent,
      memories: result.memories,
      latency_ms: Date.now() - startedAt,
      ...(result.degraded ? { degraded: true } : {}),
    };

    return jsonResponse(body, 200, { 'X-Request-ID': requestId, ...rlHeaders });
  } catch (err) {
    const response = errorToResponse(err, requestId);
    for (const [k, v] of Object.entries(rlHeaders)) response.headers.set(k, v);
    return response;
  }
}
