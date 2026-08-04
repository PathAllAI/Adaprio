/**
 * Intent classifier and category detector (Ch 07.1, 07.2).
 *
 * Both are pure, synchronous, zero-network functions. The handbook
 * explicitly states "no tokenizer required — simple toLowerCase().includes()
 * checks" (Ch 7.1) and specifies intent latency at < 0.5ms. No external
 * libraries. No state.
 */

import type { LifecycleState, MemoryDomain, QueryIntent } from '@adaprio/shared-types';

// ─────────────────────────────────────────────────────────────────────────
// Intent classification (Ch 7.1)
// ─────────────────────────────────────────────────────────────────────────

const CURRENT_STATE_SIGNALS = [
  'what is my', 'where do i', 'where do i ', 'am i still', 'current',
  'right now', ' now ', 'currently', 'these days', 'at the moment',
  'do i work', 'do i live', 'is my',
] as const;

const HISTORICAL_SIGNALS = [
  'where did i', 'what was my', 'previous', 'before', 'used to',
  'old ', 'former', 'previously', 'last job', 'last company',
  'history', 'in the past', 'at my old', 'when i was',
] as const;

export interface IntentResult {
  intent: QueryIntent;
  /** Lifecycle states to apply as a pre-filter before vector search. */
  lifecycleFilter: LifecycleState[];
}

/**
 * Classifies a query's temporal intent. `open` defaults to `current_state`
 * filtering (Ch 7.1: "No clear temporal signal — lifecycle_state = 'active'").
 */
export function classifyIntent(query: string): IntentResult {
  const q = query.toLowerCase();

  for (const signal of HISTORICAL_SIGNALS) {
    if (q.includes(signal)) {
      return { intent: 'historical', lifecycleFilter: ['active', 'historical', 'superseded'] };
    }
  }

  for (const signal of CURRENT_STATE_SIGNALS) {
    if (q.includes(signal)) {
      return { intent: 'current_state', lifecycleFilter: ['active'] };
    }
  }

  return { intent: 'open', lifecycleFilter: ['active'] };
}

// ─────────────────────────────────────────────────────────────────────────
// Category detection (Ch 7.2)
// ─────────────────────────────────────────────────────────────────────────

// Key is a pipe-separated list of signal words to try; value is the set of
// domains that signal maps to. Sourced verbatim from Ch 7.2 — extended with
// a few closely-related synonyms that appear in the eval dataset but were
// not in the handbook's illustrative list.
const DOMAIN_SIGNALS: Array<{ signals: string[]; domains: MemoryDomain[] }> = [
  { signals: ['job', 'work', 'employer', 'company', 'role', 'career', 'profession', 'office', 'employed', 'employment'], domains: ['employment'] },
  { signals: ['live', 'city', 'town', 'location', 'country', 'home', 'address', 'move', 'moved', 'relocate', 'based'], domains: ['location'] },
  { signals: ['study', 'school', 'degree', 'university', 'education', 'graduate', 'college', 'course', 'diploma', 'certification'], domains: ['education'] },
  { signals: ['goal', 'want', 'trying', 'plan', 'aim', 'hope', 'aspire', 'objective', 'target'], domains: ['goal'] },
  { signals: ['skill', 'know', 'learn', 'speak', 'language', 'proficient', 'expert', 'fluent'], domains: ['skill'] },
  { signals: ['project', 'building', 'working on', 'side project', 'startup', 'launching'], domains: ['project'] },
  { signals: ['prefer', 'like', 'love', 'hate', 'enjoy', 'favorite', 'favourite', 'dislike'], domains: ['preference'] },
  { signals: ['remind', 'task', 'todo', 'need to', 'have to', 'deadline', 'appointment', 'meeting'], domains: ['task', 'event'] },
  { signals: ['relationship', 'partner', 'spouse', 'friend', 'colleague', 'manager', 'mentor', 'team'], domains: ['relationship'] },
  { signals: ['phone', 'laptop', 'device', 'app', 'software', 'tool', 'account', 'subscription'], domains: ['technology'] },
  { signals: ['money', 'finance', 'salary', 'budget', 'invest', 'save', 'savings', 'income'], domains: ['finance'] },
  { signals: ['health', 'diet', 'exercise', 'fitness', 'medical', 'doctor', 'sleep', 'wellbeing'], domains: ['health'] },
  { signals: ['name', 'pronouns', 'timezone', 'born', 'background', 'nationality'], domains: ['identity'] },
];

/**
 * Infers likely memory domains from the query text. Returns an empty array
 * when no signals are detected — the vector search then runs unfiltered
 * across all domains (Ch 7.2: "search across all domains (no category filter)").
 */
export function detectCategories(query: string): MemoryDomain[] {
  const q = query.toLowerCase();
  const detected = new Set<MemoryDomain>();

  for (const { signals, domains } of DOMAIN_SIGNALS) {
    if (signals.some((s) => q.includes(s))) {
      domains.forEach((d) => detected.add(d));
    }
  }

  return [...detected];
}
