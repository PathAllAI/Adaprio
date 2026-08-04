import type { FeedbackResponse } from '@adaprio/shared-types';
import { authenticateRequest } from '../lib/auth.js';
import { getOrCreateRequestId, jsonResponse, errorToResponse } from '../lib/http.js';
import { invalidRequest } from '../lib/errors.js';
import { FeedbackRequestSchema, zodIssuesToDetails } from '../lib/request-schemas.js';
import type { TenantRepository } from '../repositories/tenant-repository.js';
import type { MemoryRepository } from '../repositories/memory-repository.js';
import type { FeedbackRepository } from '../repositories/feedback-repository.js';

/**
 * ⚠️ Ch 10.7 defines rate-limit tiers for `write` and `retrieve` only —
 * feedback isn't mentioned. This route deliberately does not rate-limit
 * feedback submissions rather than inventing a third tier unprompted.
 * Confirm this is intentional (feedback is low-volume, one submission per
 * retrieved memory a customer chooses to rate) or request a tier.
 */

export interface FeedbackRouteDeps {
  tenantRepo: TenantRepository;
  memoryRepo: MemoryRepository;
  feedbackRepo: FeedbackRepository;
  apiKeyPepper: string;
}

export async function handleFeedback(request: Request, deps: FeedbackRouteDeps): Promise<Response> {
  const requestId = getOrCreateRequestId(request);

  try {
    const tenant = await authenticateRequest(request, {
      tenantRepo: deps.tenantRepo,
      apiKeyPepper: deps.apiKeyPepper,
    });

    const rawBody = await request.json().catch(() => null);
    const parsed = FeedbackRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw invalidRequest('One or more fields failed validation.', zodIssuesToDetails(parsed.error.issues));
    }

    // Ownership check (see memory-repository.ts#findById) — reject
    // feedback referencing a memory_id that doesn't belong to this
    // tenant+user, rather than trusting the client-supplied id blindly.
    const memory = await deps.memoryRepo.findById({
      tenantId: tenant.tenantId,
      userId: parsed.data.user_id,
      memoryId: parsed.data.memory_id,
    });
    if (!memory) {
      throw invalidRequest('memory_id does not exist for this user.', [
        { field: 'memory_id', issue: 'not_found' },
      ]);
    }

    await deps.feedbackRepo.create({
      tenantId: tenant.tenantId,
      userId: parsed.data.user_id,
      requestId: parsed.data.request_id,
      memoryId: parsed.data.memory_id,
      feedback: parsed.data.feedback,
      note: parsed.data.note,
    });

    const body: FeedbackResponse = { status: 'accepted', request_id: requestId };
    return jsonResponse(body, 200, { 'X-Request-ID': requestId });
  } catch (err) {
    return errorToResponse(err, requestId);
  }
}
