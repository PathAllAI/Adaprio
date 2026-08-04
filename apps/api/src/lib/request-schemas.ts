import { z } from 'zod';
import { MEMORY_DOMAINS } from '@adaprio/shared-types';
import type { ApiErrorDetail } from '@adaprio/shared-types';

const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

// ── Request schemas (Ch 10.9) ────────────────────────────────────────────

export const ProcessRequestSchema = z.object({
  user_id: z.string().min(1).max(128).regex(ID_PATTERN),
  session_id: z.string().min(1).max(128).regex(ID_PATTERN).optional(),
  message: z.string().min(1).max(4000),
});

export const RetrieveOptionsSchema = z
  .object({
    min_confidence: z.number().min(0).max(1).optional(),
    max_results: z.number().int().min(1).max(50).optional(),
    include_historical: z.boolean().optional(),
    categories: z.array(z.enum(MEMORY_DOMAINS)).optional(),
  })
  .optional();

export const RetrieveRequestSchema = z.object({
  user_id: z.string().min(1).max(128).regex(ID_PATTERN),
  query: z.string().min(1).max(1000),
  options: RetrieveOptionsSchema,
});

export const FeedbackRequestSchema = z.object({
  request_id: z.string().min(1),
  user_id: z.string().min(1).max(128).regex(ID_PATTERN),
  memory_id: z.string().min(1),
  feedback: z.enum(['relevant', 'irrelevant', 'outdated', 'incorrect']),
  note: z.string().max(500).optional(),
});

// ── Zod issue → Ch 10.9 details array mapper ─────────────────────────────

/**
 * ⚠️ Ch 10.9 shows illustrative `details` entries (`exceeds_max_length`
 * with `max`/`received`, `pattern_mismatch` with `pattern`,
 * `invalid_enum_value` with `allowed`/`received`) — not a byte-exact
 * contract for every possible zod issue code. This mapper matches those
 * three illustrated shapes exactly where zod's issue data supports it and
 * falls back to the raw zod issue code + message for anything else.
 * Confirm the fallback shape is acceptable, or provide a complete mapping
 * table if the SDK's error-detail parsing needs to be exhaustive.
 */
export function zodIssuesToDetails(issues: z.ZodIssue[]): ApiErrorDetail[] {
  return issues.map((issue): ApiErrorDetail => {
    const field = issue.path.length > 0 ? issue.path.join('.') : '(root)';

    switch (issue.code) {
      case 'too_big':
        return { field, issue: 'exceeds_max_length', max: issue.maximum };
      case 'too_small':
        return { field, issue: 'below_min_length', min: issue.minimum };
      case 'invalid_string':
        return {
          field,
          issue: 'pattern_mismatch',
          ...('validation' in issue ? { pattern: String(issue.validation) } : {}),
        };
      case 'invalid_enum_value':
        return { field, issue: 'invalid_enum_value', allowed: issue.options, received: issue.received };
      case 'invalid_type':
        return { field, issue: 'invalid_type', expected: issue.expected, received: issue.received };
      default:
        return { field, issue: issue.code, message: issue.message };
    }
  });
}
