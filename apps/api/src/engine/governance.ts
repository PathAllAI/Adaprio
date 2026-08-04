/**
 * Governance Engine (Ch 06) — the deterministic, zero-LLM layer that
 * decides what happens to every extracted memory before it reaches the
 * database. Every operation here is:
 *   - Rule-based and reproducible (Ch ADR-002)
 *   - Executed via GovernanceRepository methods (Ch 9.9)
 *   - Never a direct SQL call or supabase.from() invocation
 *
 * This module owns:
 *   - Importance score adjustment (Ch 5.3)
 *   - TTL calculation (Ch 5.4)
 *   - `hypothetical` certainty handling (Ch 5.2 gap — see resolveCertaintyForStorage)
 *   - Four conflict rules (Ch 6.2)
 *   - Multi-value entity routing (Ch 6.5)
 *   - Forget-command deletion (Ch 5.1, rule filter output)
 *
 * This module does NOT own:
 *   - Embedding generation (src/pipeline/write.ts calls the embedding
 *     adapter after governance completes)
 *   - Repair-retry / dead-letter queue (src/pipeline/write.ts)
 *   - Any retrieval logic
 */

import type { EntityKey, ExtractedMemory, ExtractionCertainty, Certainty } from '@adaprio/shared-types';
import { resolveCertaintyForStorage } from '@adaprio/shared-types';
import { getRegistryEntry } from './entity-registry.js';
import type { GovernanceRepository } from '../repositories/governance-repository.js';
import type { MemoryRepository } from '../repositories/memory-repository.js';
import type { MemoryRow } from '../types/db.js';

// ─────────────────────────────────────────────────────────────────────────
// Importance scoring (Ch 5.3)
// ─────────────────────────────────────────────────────────────────────────

export function adjustImportance(
  llmImportance: number,
  mem: ExtractedMemory,
  existingReinforcementScore = 0
): number {
  let score = llmImportance;

  if (mem.entity_key.startsWith('identity.')) score += 0.1;
  if (mem.certainty === 'tentative')           score -= 0.2;
  if (mem.certainty === 'hypothetical')        score -= 0.4;
  if (mem.is_negation)                         score -= 0.1;
  if (mem.ttl_policy === 'short')              score -= 0.15;
  if (existingReinforcementScore > 0)          score += 0.05;

  // Clamp to [0.05, 1.0] (Ch 5.3)
  return Math.min(1.0, Math.max(0.05, score));
}

// ─────────────────────────────────────────────────────────────────────────
// TTL calculation (Ch 5.4)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Computes the ISO-8601 `expires_at` for memories whose TTL policy is
 * `short`, `medium`, or `long`. Returns `null` for `permanent` and
 * `until_changed` — the DB trigger handles those and they should never
 * have an `expires_at`.
 */
export function calculateExpiresAt(
  ttlPolicy: ExtractedMemory['ttl_policy'],
  importanceScore: number,
  reinforcementScore: number,
  certainty: ExtractionCertainty
): string | null {
  const entry = { short: 7, medium: 90, long: 365 } as const;
  if (ttlPolicy === 'permanent' || ttlPolicy === 'until_changed') return null;

  const baseDays = entry[ttlPolicy];
  const finalDays = Math.round(
    baseDays
    * (1 + 0.5  * importanceScore)
    * (1 + 0.2  * reinforcementScore)
    * (certainty === 'tentative' ? 0.5 : 1.0)
  );

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + Math.max(1, finalDays));
  return expiresAt.toISOString();
}

// ─────────────────────────────────────────────────────────────────────────
// Governance result types
// ─────────────────────────────────────────────────────────────────────────

export interface GovernanceOutcome {
  memory: MemoryRow;
  /** Which of the four rules was applied (for logging / memory_events audit). */
  rule: 'rule_1_replacement' | 'rule_2_tentative' | 'rule_3_departure' | 'rule_4_correction' | 'multi_value_insert' | 'no_rule_new_entity';
  /** Whether an existing active record was superseded / archived. */
  superseded: boolean;
}

export interface DepartureOutcome {
  rule: 'rule_3_departure';
  entityKey: EntityKey;
  /** true = an active record was found and archived; false = nothing to archive. */
  archived: boolean;
}

export interface CorrectionOutcome {
  rule: 'rule_4_correction';
  entityKey: EntityKey;
  rowsAffected: number; // 0 = AMM2006, >0 = rows deleted
}

export interface ForgetOutcome {
  entityHint: string | null;
  rowsAffected: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Governance Engine
// ─────────────────────────────────────────────────────────────────────────

export class GovernanceEngine {
  constructor(
    private readonly gov: GovernanceRepository,
    private readonly mem: MemoryRepository
  ) {}

  /**
   * Routes one extracted memory through the correct conflict rule.
   * Embedding is NOT applied here — the caller (pipeline/write.ts) handles
   * embedding after all governance decisions are made, so a failed embedding
   * call never rolls back a committed memory row.
   *
   * Returns `null` when the memory is dropped (only case: `hypothetical`
   * certainty — see Ch 5.2 gap note in shared-types/memory.ts).
   */
  async apply(params: {
    tenantId: string;
    userId: string;
    mem: ExtractedMemory;
    embedding: number[] | null;
  }): Promise<GovernanceOutcome | null> {
    const { tenantId, userId, mem, embedding } = params;

    // ── Certainty gate ──────────────────────────────────────────────────
    // Drop `hypothetical` memories — they must never reach the DB.
    const certainty: Certainty | null = resolveCertaintyForStorage(mem.certainty);
    if (certainty === null) return null;

    const entry = getRegistryEntry(mem.entity_key);

    const importanceScore = adjustImportance(mem.importance, mem);
    const expiresAt = calculateExpiresAt(
      mem.ttl_policy, importanceScore, 0, mem.certainty
    );

    // ── Rule 3: Departure (is_negation takes precedence over Rule 1) ────
    if (mem.is_negation) {
      return this.applyDeparture({ tenantId, userId, mem });
    }

    // ── Rule 4: Retroactive Correction ──────────────────────────────────
    if (mem.is_correction) {
      return this.applyCorrection({ tenantId, userId, mem, importanceScore, expiresAt });
    }

    // ── Multi-value entities — no conflict rules apply (Ch 6.5) ─────────
    if (entry.allowsMultiple) {
      const row = await this.gov.applyMultiValueInsert({
        tenantId, userId,
        entityKey: mem.entity_key,
        value: mem.value,
        memoryText: mem.memory_text,
        certainty,
        embedding,
      });
      return { memory: row, rule: 'multi_value_insert', superseded: false };
    }

    // ── Rule 2: Tentative/Future State (Ch 6.2) ──────────────────────────
    // A tentative memory is always a parallel insert — it never displaces
    // an existing confirmed record. We reuse `applyMultiValueInsert`
    // (see memory-repository.ts#insertTentative for the rationale).
    if (certainty === 'tentative') {
      const row = await this.mem.insertTentative({
        tenantId, userId,
        entityKey: mem.entity_key,
        value: mem.value,
        memoryText: mem.memory_text,
        embedding,
      });
      return { memory: row, rule: 'rule_2_tentative', superseded: false };
    }

    // ── Rule 1: Direct Replacement (Ch 6.2) ──────────────────────────────
    // `apply_direct_replacement` handles both the "new entity key with no
    // prior record" case (v_old_id IS NULL — no archive step runs) and the
    // genuine replacement case. The distinction is visible to the caller
    // via `superseded` below.
    const existing = await this.mem.activeMemoryFor({ tenantId, userId, entityKey: mem.entity_key });

    const row = await this.gov.applyDirectReplacement({
      tenantId, userId,
      entityKey: mem.entity_key,
      value: mem.value,
      memoryText: mem.memory_text,
      certainty,
      embedding,
    });

    return {
      memory: row,
      rule: existing ? 'rule_1_replacement' : 'no_rule_new_entity',
      superseded: !!existing,
    };
  }

  /**
   * Rule 3 — Departure Without Replacement (Ch 6.2). Archives the active
   * record to `historical`. Returns a departure outcome (not a MemoryRow —
   * no new row is inserted). Callers that need to know whether anything was
   * actually archived should check `outcome.archived`.
   */
  private async applyDeparture(params: {
    tenantId: string;
    userId: string;
    mem: ExtractedMemory;
  }): Promise<GovernanceOutcome> {
    const { tenantId, userId, mem } = params;
    const existing = await this.mem.activeMemoryFor({ tenantId, userId, entityKey: mem.entity_key });
    await this.gov.applyDeparture({ tenantId, userId, entityKey: mem.entity_key });

    // Rule 3 produces no new row. We return a synthetic MemoryRow-shaped
    // object representing the archived state of the existing row, or a
    // minimal placeholder when nothing was archived. The pipeline only uses
    // this for logging — it never writes this to the API response directly.
    return {
      memory: existing as unknown as MemoryRow ?? { id: '', entity_key: mem.entity_key } as unknown as MemoryRow,
      rule: 'rule_3_departure',
      superseded: !!existing,
    };
  }

  /**
   * Rule 4 — Retroactive Correction (Ch 6.2). Marks matching rows
   * `deleted` + `is_correction = true`. The trigger logs a `CORRECT`
   * event (not `ARCHIVE`). May also need to insert a fresh correct record
   * if the correction includes a replacement value (e.g. "I never worked
   * at Google — it was Microsoft"). In the MVP, correction + replacement is
   * treated as two separate messages (correction first, then an ordinary
   * confirmed write); the LLM only sets `is_correction = true` for the
   * retraction, not the new value.
   */
  private async applyCorrection(params: {
    tenantId: string;
    userId: string;
    mem: ExtractedMemory;
    importanceScore: number;
    expiresAt: string | null;
  }): Promise<GovernanceOutcome> {
    const { tenantId, userId, mem } = params;

    // Use the value field as the pattern hint — it's the short normalized
    // value (e.g. "Google") the LLM extracted, ideal for the ILIKE match.
    const rowsAffected = await this.gov.applyCorrection({
      tenantId, userId,
      entityKey: mem.entity_key,
      valuePattern: mem.value,
    });

    // A correction with zero rows affected is AMM2006 (CorrectionTargetNotFound)
    // — informational, not a hard error. The pipeline logs it; we still
    // return a valid outcome so the pipeline doesn't crash.

    // Correction produces no new row of its own. Return a placeholder.
    return {
      memory: { id: '', entity_key: mem.entity_key, tenant_id: tenantId, user_id: userId } as unknown as MemoryRow,
      rule: 'rule_4_correction',
      superseded: rowsAffected > 0,
    };
  }

  /**
   * Forget-command deletion path (Ch 5.1, 14.3). Invoked directly by the
   * pipeline when the rule filter returns `{ action: 'forget' }`, bypassing
   * LLM extraction entirely. Searches `value` by the entity hint extracted
   * from the message, across all lifecycle states except `deleted`.
   *
   * ⚠️ PROPOSED: the handbook (Ch 5.1) states the governance engine "does
   * a similarity search against memory_text" for forget commands, but
   * migration 007 only has `apply_correction` which searches `value ILIKE`.
   * This implementation uses `apply_correction` across ALL entity keys
   * (not one specific entity_key) via a loop over a metadataSearch result
   * — imperfect but the smallest extension consistent with both constraints
   * (no new Postgres function, use only what migration 007 provides).
   * Confirm this interpretation or request a dedicated `apply_forget`
   * Postgres function (migration 012) if a more precise match is needed.
   */
  async applyForget(params: {
    tenantId: string;
    userId: string;
    entityHint: string | null;
  }): Promise<ForgetOutcome> {
    const { tenantId, userId, entityHint } = params;
    if (!entityHint) return { entityHint: null, rowsAffected: 0 };

    // Find candidate entity keys that have memories matching the hint.
    const candidates = await this.mem.metadataSearch({
      tenantId,
      userId,
      lifecycleFilter: ['active', 'historical'],
      limit: 20,
    });

    const matching = candidates.filter((c) =>
      c.value.toLowerCase().includes(entityHint.toLowerCase())
    );

    let totalAffected = 0;
    for (const match of matching) {
      const affected = await this.gov.applyCorrection({
        tenantId,
        userId,
        entityKey: match.entityKey,
        valuePattern: entityHint,
      });
      totalAffected += affected;
    }

    return { entityHint, rowsAffected: totalAffected };
  }
}
