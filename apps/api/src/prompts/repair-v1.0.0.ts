/**
 * Ch 30.2 — repair prompt, used once per write when the first extraction
 * attempt fails JSON-schema validation (Ch 04.4).
 *
 * ⚠️ NECESSARY ADDITION, not in Ch 30.2's literal template: the handbook's
 * repair template includes only the previous malformed response, the
 * validation errors, and the schema — it never re-includes the ORIGINAL
 * user message. Without the source text, the model has nothing to extract
 * from on retry; this looks like an oversight in Ch 30.2 rather than a
 * deliberate omission (a repair prompt that can't see what it's repairing
 * FROM can't productively repair anything). `buildRepairMessage` below
 * prepends the original message before Ch 30.2's template. Flagging in
 * case there's context for the omission that isn't visible here.
 */
export const REPAIR_PROMPT_VERSION = 'v1.0.0';

export function buildRepairMessage(originalMessage: string, previousResponseRaw: string, errorSummary: string): string {
  return `Original user message:
${originalMessage}

Your previous response did not conform to the required JSON schema.

Previous response (malformed):
${previousResponseRaw}

Validation errors:
${errorSummary}

Return ONLY valid JSON matching the required schema (contains_memory, memories[] with entity_key/value/memory_text/certainty/importance/ttl_policy/contradiction/is_negation/is_correction/entities). No preamble, no explanation, no code fences.`;
}
