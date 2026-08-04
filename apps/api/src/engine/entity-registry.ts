/**
 * In-process entity key registry (Ch 08, 09.2).
 *
 * The handbook states `entity_key_registry` is "read-only at runtime" but
 * does not specify HOW the governance engine reads it — a DB query per
 * write call, a cached map, or an in-process constant. Three options exist:
 *
 *   A) Query the DB on every write call.
 *      Latency cost: +5–20ms per write (extra round-trip). Correct if the
 *      registry could ever change at runtime. But it can't — the handbook
 *      explicitly states "only migrations touch it" (Ch 9.2) and the
 *      taxonomy is frozen (Ch 8.5). Zero benefit.
 *
 *   B) Cache with a TTL (warm on first request, refresh periodically).
 *      Adds complexity (cache invalidation, stale-read window) with no
 *      real benefit given that the registry never changes at runtime.
 *
 *   C) Compile the registry into an in-process constant derived from
 *      `packages/shared-types/entity-keys.generated.ts` (chosen here).
 *      Zero latency, zero DB round-trips, statically typed, guaranteed
 *      consistent with the 60-key set that the type system already knows
 *      about. The tradeoff — a code deploy is required to pick up a new
 *      entity key — is not a tradeoff at all: new entity keys already
 *      require a code deploy (migration + seed + prompt update + eval
 *      dataset). Nothing in this module changes that lifecycle.
 *
 * If the handbook is updated to require a DB-backed registry (e.g. to
 * support tenants extending the taxonomy independently), this module's
 * public interface is the only thing the governance engine calls — swapping
 * the backing source is a change inside this file only.
 */

import type { EntityKey } from '@adaprio/shared-types';

export interface RegistryEntry {
  entityKey: EntityKey;
  domain: string;
  allowsMultiple: boolean;
  allowsVersioning: boolean;
  defaultTtlPolicy: 'permanent' | 'until_changed' | 'short' | 'medium' | 'long';
  /** null for permanent / until_changed */
  defaultTtlDays: number | null;
  sensitivityLevel: 'low' | 'medium' | 'high';
}

// All 60 entries sourced from Appendix A (Ch 25-A) and the DB seed
// generator (packages/db/seed/generate-entity-registry-seed.cjs).
// MUST stay byte-identical to that generator's KEYS + attribute rules.
const REGISTRY_MAP: Readonly<Record<EntityKey, RegistryEntry>> = {
  'identity.name':                { entityKey: 'identity.name',                domain: 'identity',      allowsMultiple: false, allowsVersioning: true,  defaultTtlPolicy: 'until_changed', defaultTtlDays: null, sensitivityLevel: 'low'    },
  'identity.nickname':            { entityKey: 'identity.nickname',            domain: 'identity',      allowsMultiple: false, allowsVersioning: true,  defaultTtlPolicy: 'until_changed', defaultTtlDays: null, sensitivityLevel: 'low'    },
  'identity.language':            { entityKey: 'identity.language',            domain: 'identity',      allowsMultiple: false, allowsVersioning: true,  defaultTtlPolicy: 'until_changed', defaultTtlDays: null, sensitivityLevel: 'low'    },
  'identity.timezone':            { entityKey: 'identity.timezone',            domain: 'identity',      allowsMultiple: false, allowsVersioning: true,  defaultTtlPolicy: 'until_changed', defaultTtlDays: null, sensitivityLevel: 'low'    },
  'identity.birth_date':          { entityKey: 'identity.birth_date',          domain: 'identity',      allowsMultiple: false, allowsVersioning: false, defaultTtlPolicy: 'permanent',      defaultTtlDays: null, sensitivityLevel: 'medium' },
  'identity.cultural_background': { entityKey: 'identity.cultural_background', domain: 'identity',      allowsMultiple: false, allowsVersioning: false, defaultTtlPolicy: 'permanent',      defaultTtlDays: null, sensitivityLevel: 'medium' },

  'location.country':   { entityKey: 'location.country',   domain: 'location',    allowsMultiple: false, allowsVersioning: true,  defaultTtlPolicy: 'until_changed', defaultTtlDays: null, sensitivityLevel: 'low'    },
  'location.city':      { entityKey: 'location.city',      domain: 'location',    allowsMultiple: false, allowsVersioning: true,  defaultTtlPolicy: 'until_changed', defaultTtlDays: null, sensitivityLevel: 'low'    },
  'location.region':    { entityKey: 'location.region',    domain: 'location',    allowsMultiple: false, allowsVersioning: true,  defaultTtlPolicy: 'until_changed', defaultTtlDays: null, sensitivityLevel: 'low'    },
  'location.residence': { entityKey: 'location.residence', domain: 'location',    allowsMultiple: false, allowsVersioning: true,  defaultTtlPolicy: 'until_changed', defaultTtlDays: null, sensitivityLevel: 'medium' },
  'location.previous':  { entityKey: 'location.previous',  domain: 'location',    allowsMultiple: true,  allowsVersioning: false, defaultTtlPolicy: 'permanent',      defaultTtlDays: null, sensitivityLevel: 'low'    },

  'employment.organization': { entityKey: 'employment.organization', domain: 'employment', allowsMultiple: false, allowsVersioning: true,  defaultTtlPolicy: 'until_changed', defaultTtlDays: null, sensitivityLevel: 'low' },
  'employment.role':         { entityKey: 'employment.role',         domain: 'employment', allowsMultiple: false, allowsVersioning: true,  defaultTtlPolicy: 'until_changed', defaultTtlDays: null, sensitivityLevel: 'low' },
  'employment.industry':     { entityKey: 'employment.industry',     domain: 'employment', allowsMultiple: false, allowsVersioning: true,  defaultTtlPolicy: 'until_changed', defaultTtlDays: null, sensitivityLevel: 'low' },
  'employment.status':       { entityKey: 'employment.status',       domain: 'employment', allowsMultiple: false, allowsVersioning: true,  defaultTtlPolicy: 'until_changed', defaultTtlDays: null, sensitivityLevel: 'low' },
  'employment.work_style':   { entityKey: 'employment.work_style',   domain: 'employment', allowsMultiple: false, allowsVersioning: true,  defaultTtlPolicy: 'until_changed', defaultTtlDays: null, sensitivityLevel: 'low' },
  'employment.experience':   { entityKey: 'employment.experience',   domain: 'employment', allowsMultiple: true,  allowsVersioning: false, defaultTtlPolicy: 'permanent',      defaultTtlDays: null, sensitivityLevel: 'low' },

  'education.institution': { entityKey: 'education.institution', domain: 'education', allowsMultiple: false, allowsVersioning: true,  defaultTtlPolicy: 'until_changed', defaultTtlDays: null, sensitivityLevel: 'low' },
  'education.field':       { entityKey: 'education.field',       domain: 'education', allowsMultiple: false, allowsVersioning: true,  defaultTtlPolicy: 'until_changed', defaultTtlDays: null, sensitivityLevel: 'low' },
  'education.degree':      { entityKey: 'education.degree',      domain: 'education', allowsMultiple: false, allowsVersioning: true,  defaultTtlPolicy: 'until_changed', defaultTtlDays: null, sensitivityLevel: 'low' },
  'education.level':       { entityKey: 'education.level',       domain: 'education', allowsMultiple: false, allowsVersioning: true,  defaultTtlPolicy: 'until_changed', defaultTtlDays: null, sensitivityLevel: 'low' },
  'education.status':      { entityKey: 'education.status',      domain: 'education', allowsMultiple: false, allowsVersioning: true,  defaultTtlPolicy: 'until_changed', defaultTtlDays: null, sensitivityLevel: 'low' },

  'skill.technical':    { entityKey: 'skill.technical',    domain: 'skill', allowsMultiple: true, allowsVersioning: false, defaultTtlPolicy: 'long',   defaultTtlDays: 365, sensitivityLevel: 'low' },
  'skill.language':     { entityKey: 'skill.language',     domain: 'skill', allowsMultiple: true, allowsVersioning: false, defaultTtlPolicy: 'long',   defaultTtlDays: 365, sensitivityLevel: 'low' },
  'skill.professional': { entityKey: 'skill.professional', domain: 'skill', allowsMultiple: true, allowsVersioning: false, defaultTtlPolicy: 'long',   defaultTtlDays: 365, sensitivityLevel: 'low' },
  'skill.learning':     { entityKey: 'skill.learning',     domain: 'skill', allowsMultiple: true, allowsVersioning: false, defaultTtlPolicy: 'medium', defaultTtlDays: 90,  sensitivityLevel: 'low' },

  'project.name':       { entityKey: 'project.name',       domain: 'project', allowsMultiple: true, allowsVersioning: false, defaultTtlPolicy: 'medium', defaultTtlDays: 90, sensitivityLevel: 'low' },
  'project.type':       { entityKey: 'project.type',       domain: 'project', allowsMultiple: true, allowsVersioning: false, defaultTtlPolicy: 'medium', defaultTtlDays: 90, sensitivityLevel: 'low' },
  'project.status':     { entityKey: 'project.status',     domain: 'project', allowsMultiple: true, allowsVersioning: false, defaultTtlPolicy: 'medium', defaultTtlDays: 90, sensitivityLevel: 'low' },
  'project.goal':       { entityKey: 'project.goal',       domain: 'project', allowsMultiple: true, allowsVersioning: false, defaultTtlPolicy: 'medium', defaultTtlDays: 90, sensitivityLevel: 'low' },
  'project.technology': { entityKey: 'project.technology', domain: 'project', allowsMultiple: true, allowsVersioning: false, defaultTtlPolicy: 'medium', defaultTtlDays: 90, sensitivityLevel: 'low' },

  'goal.personal':   { entityKey: 'goal.personal',   domain: 'goal', allowsMultiple: true, allowsVersioning: false, defaultTtlPolicy: 'medium', defaultTtlDays: 90, sensitivityLevel: 'low' },
  'goal.career':     { entityKey: 'goal.career',     domain: 'goal', allowsMultiple: true, allowsVersioning: false, defaultTtlPolicy: 'medium', defaultTtlDays: 90, sensitivityLevel: 'low' },
  'goal.education':  { entityKey: 'goal.education',  domain: 'goal', allowsMultiple: true, allowsVersioning: false, defaultTtlPolicy: 'medium', defaultTtlDays: 90, sensitivityLevel: 'low' },
  'goal.financial':  { entityKey: 'goal.financial',  domain: 'goal', allowsMultiple: true, allowsVersioning: false, defaultTtlPolicy: 'medium', defaultTtlDays: 90, sensitivityLevel: 'high' },
  'goal.health':     { entityKey: 'goal.health',     domain: 'goal', allowsMultiple: true, allowsVersioning: false, defaultTtlPolicy: 'medium', defaultTtlDays: 90, sensitivityLevel: 'low' },
  'goal.timeline':   { entityKey: 'goal.timeline',   domain: 'goal', allowsMultiple: true, allowsVersioning: false, defaultTtlPolicy: 'short',  defaultTtlDays: 7,  sensitivityLevel: 'low' },

  'preference.general':               { entityKey: 'preference.general',               domain: 'preference', allowsMultiple: true, allowsVersioning: false, defaultTtlPolicy: 'long',         defaultTtlDays: 365, sensitivityLevel: 'low' },
  'preference.communication_style':   { entityKey: 'preference.communication_style',   domain: 'preference', allowsMultiple: false, allowsVersioning: true, defaultTtlPolicy: 'until_changed', defaultTtlDays: null, sensitivityLevel: 'low' },
  'preference.technology':            { entityKey: 'preference.technology',            domain: 'preference', allowsMultiple: true, allowsVersioning: false, defaultTtlPolicy: 'long',         defaultTtlDays: 365, sensitivityLevel: 'low' },
  'preference.food':                  { entityKey: 'preference.food',                  domain: 'preference', allowsMultiple: true, allowsVersioning: false, defaultTtlPolicy: 'long',         defaultTtlDays: 365, sensitivityLevel: 'low' },
  'preference.entertainment':         { entityKey: 'preference.entertainment',         domain: 'preference', allowsMultiple: true, allowsVersioning: false, defaultTtlPolicy: 'long',         defaultTtlDays: 365, sensitivityLevel: 'low' },
  'preference.learning_style':        { entityKey: 'preference.learning_style',        domain: 'preference', allowsMultiple: false, allowsVersioning: true, defaultTtlPolicy: 'until_changed', defaultTtlDays: null, sensitivityLevel: 'low' },

  'ai.response_style':     { entityKey: 'ai.response_style',     domain: 'ai', allowsMultiple: false, allowsVersioning: true, defaultTtlPolicy: 'until_changed', defaultTtlDays: null, sensitivityLevel: 'low' },
  'ai.workflow_preference': { entityKey: 'ai.workflow_preference', domain: 'ai', allowsMultiple: false, allowsVersioning: true, defaultTtlPolicy: 'until_changed', defaultTtlDays: null, sensitivityLevel: 'low' },
  'ai.model_preference':   { entityKey: 'ai.model_preference',   domain: 'ai', allowsMultiple: false, allowsVersioning: true, defaultTtlPolicy: 'until_changed', defaultTtlDays: null, sensitivityLevel: 'low' },

  'relationship.person':       { entityKey: 'relationship.person',       domain: 'relationship', allowsMultiple: true, allowsVersioning: false, defaultTtlPolicy: 'long', defaultTtlDays: 365, sensitivityLevel: 'medium' },
  'relationship.role':         { entityKey: 'relationship.role',         domain: 'relationship', allowsMultiple: true, allowsVersioning: false, defaultTtlPolicy: 'long', defaultTtlDays: 365, sensitivityLevel: 'low'    },
  'relationship.organization': { entityKey: 'relationship.organization', domain: 'relationship', allowsMultiple: true, allowsVersioning: false, defaultTtlPolicy: 'long', defaultTtlDays: 365, sensitivityLevel: 'medium' },

  'task.current':  { entityKey: 'task.current',  domain: 'task', allowsMultiple: true, allowsVersioning: false, defaultTtlPolicy: 'short', defaultTtlDays: 7, sensitivityLevel: 'low' },
  'task.deadline': { entityKey: 'task.deadline', domain: 'task', allowsMultiple: true, allowsVersioning: false, defaultTtlPolicy: 'short', defaultTtlDays: 7, sensitivityLevel: 'low' },
  'task.status':   { entityKey: 'task.status',   domain: 'task', allowsMultiple: true, allowsVersioning: false, defaultTtlPolicy: 'short', defaultTtlDays: 7, sensitivityLevel: 'low' },

  'event.personal':      { entityKey: 'event.personal',      domain: 'event', allowsMultiple: true, allowsVersioning: false, defaultTtlPolicy: 'short', defaultTtlDays: 7, sensitivityLevel: 'low' },
  'event.professional':  { entityKey: 'event.professional',  domain: 'event', allowsMultiple: true, allowsVersioning: false, defaultTtlPolicy: 'short', defaultTtlDays: 7, sensitivityLevel: 'low' },
  'event.deadline':      { entityKey: 'event.deadline',      domain: 'event', allowsMultiple: true, allowsVersioning: false, defaultTtlPolicy: 'short', defaultTtlDays: 7, sensitivityLevel: 'low' },

  'technology.device':   { entityKey: 'technology.device',   domain: 'technology', allowsMultiple: true, allowsVersioning: false, defaultTtlPolicy: 'long', defaultTtlDays: 365, sensitivityLevel: 'low' },
  'technology.software': { entityKey: 'technology.software', domain: 'technology', allowsMultiple: true, allowsVersioning: false, defaultTtlPolicy: 'long', defaultTtlDays: 365, sensitivityLevel: 'low' },
  'technology.account':  { entityKey: 'technology.account',  domain: 'technology', allowsMultiple: true, allowsVersioning: false, defaultTtlPolicy: 'long', defaultTtlDays: 365, sensitivityLevel: 'low' },

  'finance.goal':      { entityKey: 'finance.goal',      domain: 'finance', allowsMultiple: true, allowsVersioning: false, defaultTtlPolicy: 'medium', defaultTtlDays: 90, sensitivityLevel: 'high' },
  'health.preference': { entityKey: 'health.preference', domain: 'health',  allowsMultiple: true, allowsVersioning: false, defaultTtlPolicy: 'medium', defaultTtlDays: 90, sensitivityLevel: 'high' },
} as const;

/** Returns the registry entry for a known entity key. Throws for an unknown key — this is a programming error, not a recoverable user error (the DB trigger would also reject it). */
export function getRegistryEntry(entityKey: EntityKey): RegistryEntry {
  const entry = REGISTRY_MAP[entityKey];
  if (!entry) throw new Error(`Unknown entity_key: ${entityKey}. This should have been caught by schema validation.`);
  return entry;
}

/** Used by the governance engine to route incoming memories to the correct conflict rule. */
export function registryAllowsMultiple(entityKey: EntityKey): boolean {
  return getRegistryEntry(entityKey).allowsMultiple;
}

export function registryAllowsVersioning(entityKey: EntityKey): boolean {
  return getRegistryEntry(entityKey).allowsVersioning;
}
