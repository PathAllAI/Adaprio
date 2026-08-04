import type { ProcessResponse } from '@adaprio/shared-types';
import { authenticateRequest } from '../lib/auth.js';
import { checkRateLimit } from '../lib/rate-limit.js';
import { getOrCreateRequestId, jsonResponse, rateLimitHeaders, errorToResponse } from '../lib/http.js';
import { invalidRequest, rateLimited } from '../lib/errors.js';
import { ProcessRequestSchema, zodIssuesToDetails } from '../lib/request-schemas.js';
import { runWritePipeline } from '../pipeline/write.js';
import type { WritePipelineDeps } from '../pipeline/write.js';
import type { TenantRepository } from '../repositories/tenant-repository.js';
import type { KVNamespaceLike } from '../lib/kv-binding.js';

export interface ProcessRouteDeps {
  tenantRepo: TenantRepository;
  rateLimitKv: KVNamespaceLike;
  apiKeyPepper: string;
  writeDeps: WritePipelineDeps;
}

export async function handleProcess(request: Request, deps: ProcessRouteDeps): Promise<Response> {
  const requestId = getOrCreateRequestId(request);
  const startedAt = Date.now();
  let rlHeaders: Record<string, string> = {};

  try {
    const tenant = await authenticateRequest(request, {
      tenantRepo: deps.tenantRepo,
      apiKeyPepper: deps.apiKeyPepper,
    });

    const rateLimit = await checkRateLimit(deps.rateLimitKv, tenant.tenantId, 'write', tenant.writesPerMin);
    rlHeaders = rateLimitHeaders(rateLimit);
    if (!rateLimit.allowed) {
      throw rateLimited(
        'Write rate limit exceeded for this tenant.',
        rateLimit.resetAt - Math.floor(Date.now() / 1000)
      );
    }

    const rawBody = await request.json().catch(() => null);
    const parsed = ProcessRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw invalidRequest('One or more fields failed validation.', zodIssuesToDetails(parsed.error.issues));
    }

    const result = await runWritePipeline(deps.writeDeps, {
      tenantId: tenant.tenantId,
      userId: parsed.data.user_id,
      sessionId: parsed.data.session_id,
      message: parsed.data.message,
    });

    const body: ProcessResponse = {
      status: result.status,
      request_id: requestId,
      memories_created: result.memoriesCreated,
      memories_updated: result.memoriesUpdated,
      memories: result.memories,
      ...(result.queuedMessage ? { message: result.queuedMessage } : {}),
      latency_ms: Date.now() - startedAt,
    };

    return jsonResponse(body, 200, { 'X-Request-ID': requestId, ...rlHeaders });
  } catch (err) {
    const response = errorToResponse(err, requestId);
    for (const [k, v] of Object.entries(rlHeaders)) response.headers.set(k, v);
    return response;
  }
}
