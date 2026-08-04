import type { ApiErrorCode } from '@adaprio/shared-types';

/**
 * The only error type pipeline code should throw. Route handlers (not yet
 * built) catch this and shape it into the Ch 10.10 error response —
 * pipeline code never constructs an HTTP Response directly (Ch 23.3:
 * "no untyped `throw new Error(string)`").
 */
export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly httpStatus: number,
    public readonly details?: Record<string, unknown>[]
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function unauthorized(message = 'Invalid or missing API key'): ApiError {
  return new ApiError('UNAUTHORIZED', message, 401);
}

export function rateLimited(message = 'Rate limit exceeded', retryAfterSeconds?: number): ApiError {
  return new ApiError(
    'RATE_LIMITED',
    message,
    429,
    retryAfterSeconds !== undefined ? [{ retry_after_seconds: retryAfterSeconds }] : undefined
  );
}

export function injectionDetected(): ApiError {
  return new ApiError('INJECTION_DETECTED', 'The message was identified as an instruction-manipulation attempt and was not processed.', 400);
}

export function invalidRequest(message: string, details?: Record<string, unknown>[]): ApiError {
  return new ApiError('INVALID_REQUEST', message, 400, details);
}

export function invalidUserId(message = 'user_id is required and must match ^[a-zA-Z0-9_-]+$'): ApiError {
  return new ApiError('INVALID_USER_ID', message, 400);
}

export function schemaValidationFailed(message: string): ApiError {
  return new ApiError('SCHEMA_VALIDATION_FAILED', message, 500);
}

export function databaseError(message = 'A database operation failed'): ApiError {
  return new ApiError('DATABASE_ERROR', message, 503);
}

export function providerUnavailable(message = 'An upstream provider is unavailable'): ApiError {
  return new ApiError('PROVIDER_UNAVAILABLE', message, 503);
}
