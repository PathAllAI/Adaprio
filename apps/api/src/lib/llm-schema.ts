import { z } from 'zod';
import { ENTITY_KEYS } from '@adaprio/shared-types';

/**
 * Validates raw LLM output against the exact contract in Ch 04.3 / 30.1.
 * `certainty` uses the full three-value LLM domain (confirmed/tentative/
 * hypothetical) — narrowing to the DB-safe two-value `Certainty` happens
 * downstream in the governance engine (`resolveCertaintyForStorage`), not
 * here. This schema's only job is "is this well-formed LLM output", not
 * "is this storable."
 */
export const ExtractedMemorySchema = z.object({
  entity_key: z.enum(ENTITY_KEYS),
  value: z.string().min(1).max(500),
  memory_text: z.string().min(1).max(4000),
  certainty: z.enum(['confirmed', 'tentative', 'hypothetical']),
  importance: z.number().min(0).max(1),
  ttl_policy: z.enum(['permanent', 'until_changed', 'short', 'medium', 'long']),
  contradiction: z.boolean(),
  is_negation: z.boolean(),
  is_correction: z.boolean(),
  entities: z.record(z.string()),
});

export const LLMResponseSchema = z.object({
  contains_memory: z.boolean(),
  memories: z.array(ExtractedMemorySchema),
});

export type ValidatedLLMResponse = z.infer<typeof LLMResponseSchema>;

export interface ValidationResult {
  valid: boolean;
  data?: ValidatedLLMResponse;
  errorSummary?: string;
}

/**
 * Validates and returns a structured result rather than throwing — the
 * write pipeline needs to distinguish "invalid, try repair" from "invalid
 * again, dead-letter" without exception-driven control flow.
 */
export function validateLLMResponse(raw: unknown): ValidationResult {
  const result = LLMResponseSchema.safeParse(raw);
  if (result.success) {
    return { valid: true, data: result.data };
  }
  return {
    valid: false,
    errorSummary: result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; '),
  };
}
