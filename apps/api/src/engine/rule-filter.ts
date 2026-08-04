/**
 * Rule filter — the first stage of every write-path request (Ch 04, 05.1).
 *
 * Contract: pure function, no side effects, no network calls. Must complete
 * in < 1ms P50 (Ch 29.2). Called before the Memory Intelligence LLM —
 * it is the reason the LLM never sees injection-attempt text at all.
 *
 * Defense-in-depth note (Ch 14.3): this layer does not need to be
 * exhaustive. It runs fast pattern-matching against known injection shapes.
 * The LLM's own system prompt carries a second, independent guard that
 * catches adversarial phrasing this layer didn't match.
 */

export type FilterAction =
  | { action: 'reject'; reason: string }
  | { action: 'forget'; entity_hint: string | null }
  | { action: 'extract' };

// ─────────────────────────────────────────────────────────────────────────
// Injection patterns (Ch 05.1 — verbatim from the handbook)
// ─────────────────────────────────────────────────────────────────────────

const INJECTION_PATTERNS: RegExp[] = [
  /ignore (previous|prior|all) instructions/i,
  /you are now in (admin|developer|god|root) mode/i,
  /disregard your (extraction|memory|system) rules/i,
  /^system:/im,
  /reveal (all|every|any) (stored|user|customer) (memories|data|information)/i,
  /export (all|every|any) (tenant|user|memory) data/i,
  /override your (ttl|lifecycle|importance|extraction) policy/i,
  /act as (the|a) (memory|database|system) administrator/i,
  /(store|save|remember) (this|the following) as (a )?(permanent|core|unforgettable) memory/i,
];

// ─────────────────────────────────────────────────────────────────────────
// Forget patterns (Ch 05.1 — verbatim from the handbook)
// ─────────────────────────────────────────────────────────────────────────

// Order matters: the first match wins. Longer / more specific prefixes must
// come before shorter ones they could accidentally shadow.
const FORGET_PREFIXES: readonly string[] = [
  'forget what i said about',
  'forget everything i said about',
  'forget that i',
  'please delete what i',
  'erase my note about',
  'remove what i told you about',
  'can you remove what',
] as const;

// Stop words stripped when extracting the entity hint (Ch 05.1).
// Kept deliberately short — this is a hint extraction, not NLP.
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'my', 'i', 'that', 'about', 'like', 'said',
  'told', 'you', 'me', 'is', 'was', 'am', 'are', 'it', 'what',
]);

// ─────────────────────────────────────────────────────────────────────────
// Entity hint extractor (Ch 05.1 — no LLM, no regex, pure token filter)
// ─────────────────────────────────────────────────────────────────────────

function extractEntityHint(remainder: string): string | null {
  const tokens = remainder
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOP_WORDS.has(t));

  if (tokens.length === 0) return null;

  // Return up to the first three content tokens, joined as a search hint.
  // The governance engine does a case-insensitive ILIKE against `value`
  // using this string, so keeping it short is correct — a hint is not a
  // sentence, and a longer hint is more likely to miss than a shorter one.
  return tokens.slice(0, 3).join(' ');
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Classifies an incoming user message into one of three actions before
 * it is sent to the Memory Intelligence LLM.
 *
 * @returns
 *   - `{ action: 'reject' }` — message is an injection attempt; do not
 *     process further, return AMM1001 to the caller.
 *   - `{ action: 'forget', entity_hint }` — message is a forget command;
 *     pass to the governance engine's deletion path, skip extraction.
 *   - `{ action: 'extract' }` — proceed to LLM extraction.
 */
export function ruleFilter(message: string): FilterAction {
  // Injection check runs first — a forget command that is also an injection
  // attempt should be rejected, not acted on.
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(message)) {
      return { action: 'reject', reason: 'injection_attempt' };
    }
  }

  const normalised = message.toLowerCase().trim();

  for (const prefix of FORGET_PREFIXES) {
    if (normalised.startsWith(prefix)) {
      const remainder = normalised.slice(prefix.length).trim();
      return { action: 'forget', entity_hint: extractEntityHint(remainder) };
    }
  }

  return { action: 'extract' };
}
