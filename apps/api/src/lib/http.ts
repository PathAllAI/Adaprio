import type { ApiErrorResponse } from '@adaprio/shared-types';
import { ApiError } from './errors.js';
import type { RateLimitResult } from './rate-limit.js';

/** Ch 10.3 — client-supplied idempotency key, or a fresh one. */
export function getOrCreateRequestId(request: Request): string {
  return request.headers.get('X-Request-ID') ?? `req_${crypto.randomUUID()}`;
}

export function jsonResponse(body: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

/** Ch 10.4 — attached to every response, success or error, once rate limiting has actually run. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(result.resetAt),
  };
}

/**
 * Converts a thrown error into the Ch 10.10 response shape. Any error that
 * is NOT an `ApiError` — i.e. something unexpected slipped through — is
 * deliberately mapped to `PROVIDER_UNAVAILABLE` rather than exposing
 * internals, mirroring Ch 10.10's explicit rule that
 * `SCHEMA_VALIDATION_FAILED` (an internal-only code) is "never returned in
 * raw form to the customer."
 */
export function errorToResponse(err: unknown, requestId: string): Response {
  if (err instanceof ApiError) {
    const body: ApiErrorResponse = {
      error: {
        code: err.code,
        message: err.message,
        request_id: requestId,
        ...(err.details ? { details: err.details } : {}),
      },
    };
    const headers: Record<string, string> = { 'X-Request-ID': requestId };
    if (err.code === 'RATE_LIMITED') {
      const retryAfter = err.details?.[0]?.retry_after_seconds;
      if (typeof retryAfter === 'number') headers['Retry-After'] = String(retryAfter);
    }
    return jsonResponse(body, err.httpStatus, headers);
  }

  const body: ApiErrorResponse = {
    error: {
      code: 'PROVIDER_UNAVAILABLE',
      message: 'An internal error occurred. Please retry.',
      request_id: requestId,
    },
  };
  return jsonResponse(body, 503, { 'X-Request-ID': requestId });
}
