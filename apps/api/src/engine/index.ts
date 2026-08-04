export { ruleFilter } from './rule-filter.js';
export type { FilterAction } from './rule-filter.js';

export { getRegistryEntry, registryAllowsMultiple, registryAllowsVersioning } from './entity-registry.js';
export type { RegistryEntry } from './entity-registry.js';

export { GovernanceEngine, adjustImportance, calculateExpiresAt } from './governance.js';
export type { GovernanceOutcome, DepartureOutcome, CorrectionOutcome, ForgetOutcome } from './governance.js';

export { classifyIntent, detectCategories } from './intent.js';
export type { IntentResult } from './intent.js';

export { scoreCandidate, applyConfidenceScoring } from './confidence.js';
export type { ScoredCandidate } from './confidence.js';
