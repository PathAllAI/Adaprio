import type { EmbeddingAdapter, ExtractedMemory, LLMAdapter, ProcessedMemorySummary, ProcessStatus } from '@adaprio/shared-types';
import { LLMAdapterError } from '@adaprio/shared-types';
import { ruleFilter } from '../engine/rule-filter.js';
import { GovernanceEngine } from '../engine/governance.js';
import type { PendingRepository } from '../repositories/pending-repository.js';
import { validateLLMResponse } from '../lib/llm-schema.js';
import { injectionDetected } from '../lib/errors.js';
import type { MemoryRow } from '../types/db.js';

export interface WritePipelineDeps {
  llm: LLMAdapter;
  embedding: EmbeddingAdapter;
  governanceEngine: GovernanceEngine;
  pendingRepo: PendingRepository;
  /** Ch 30.1 — built by src/prompts/extraction-v1.0.0.ts, injected here to keep this file prompt-agnostic. */
  extractionSystemPrompt: string;
  /**
   * Ch 30.2 — builds the repair USER message (not system prompt — see
   * the mapping note in `attemptExtraction` below for why). Injected for
   * the same reason as `extractionSystemPrompt`.
   */
  buildRepairMessage: (originalMessage: string, previousResponseRaw: string, errorSummary: string) => string;
}

export interface WritePipelineParams {
  tenantId: string;
  userId: string;
  sessionId?: string;
  message: string;
  /**
   * Set by the pending-retry cron job (Ch 27.7, src/cron/pending-retry.ts)
   * when reprocessing an already-queued message. Suppresses the normal
   * enqueue-on-failure behavior below — the pending_memory_events row
   * being retried already exists, and the caller is responsible for
   * calling `markFailed`/`markProcessed` on THAT row. Without this flag, a
   * message that fails on retry would get a second, duplicate pending row
   * enqueued by this function while the original row it came from is left
   * untouched by this pipeline, silently forking the retry history.
   */
  isRetry?: boolean;
}

export interface WritePipelineResult {
  status: ProcessStatus;
  memoriesCreated: number;
  memoriesUpdated: number;
  memories: ProcessedMemorySummary[];
  /** Present only when status === 'queued' (Ch 04.8). */
  queuedMessage?: string;
}

interface ExtractionSuccess {
  contains_memory: boolean;
  memories: ExtractedMemory[];
}

const QUEUED_MESSAGE =
  'Memory processing temporarily unavailable. Your message has been queued and will be processed within 15 minutes.';

function toSummary(row: MemoryRow, supersededCount: 0 | 1): ProcessedMemorySummary {
  return {
    id: row.id,
    entity_key: row.entity_key,
    value: row.value,
    certainty: row.certainty,
    lifecycle_state: row.lifecycle_state,
    superseded_count: supersededCount,
  };
}

/**
 * One inference call, with exactly one repair-retry on schema-validation
 * failure (Ch 04.4). Returns `null` if both the original call and the
 * repair attempt fail to produce valid JSON — the caller dead-letters.
 *
 * ⚠️ MAPPING NOTE: Ch 30.2's repair template is written as user-turn
 * content ("Your previous response did not conform...") rather than
 * system-turn content, so this reuses the ORIGINAL system prompt
 * (`extractionSystemPrompt`) unchanged and substitutes a repair-flavored
 * string for the `userMessage` argument instead. Not explicit in the
 * handbook which of the two `LLMAdapter.extract()` slots the repair
 * template belongs in — confirm this mapping.
 *
 * ⚠️ SIMPLIFICATION NOTE: Ch 04.4 says the repair call must use "whichever
 * provider just responded," not the fallback chain again. `LLMAdapter` as
 * currently typed (Ch 31.2) has no way to pin a specific provider or
 * report which one handled a call — if `deps.llm` is an `LLMAdapterChain`,
 * this repair call may re-attempt the primary rather than staying on the
 * provider that returned the malformed JSON. Fixing this precisely would
 * require extending `LLMAdapter.extract()` to return provenance; not done
 * here to avoid an unrequested shared-types change. Flagged for follow-up.
 */
async function attemptExtraction(deps: WritePipelineDeps, message: string): Promise<ExtractionSuccess | null> {
  const first = await deps.llm.extract(deps.extractionSystemPrompt, message);
  const firstValidation = validateLLMResponse(first);
  if (firstValidation.valid && firstValidation.data) return firstValidation.data;

  // One repair attempt (Ch 04.4).
  const repairMessage = deps.buildRepairMessage(
    message,
    JSON.stringify(first),
    firstValidation.errorSummary ?? 'unknown validation failure'
  );
  const repaired = await deps.llm.extract(deps.extractionSystemPrompt, repairMessage);
  const repairValidation = validateLLMResponse(repaired);
  if (repairValidation.valid && repairValidation.data) return repairValidation.data;

  return null;
}

/**
 * Runs the complete write pipeline for one message. Throws `ApiError`
 * (INJECTION_DETECTED) for a rejected message — everything else resolves
 * to a `WritePipelineResult`, including provider-outage and validation-
 * failure cases (both surface as `status: 'queued'`, never a thrown error,
 * per Ch 04's "never drop the message" principle).
 */
export async function runWritePipeline(
  deps: WritePipelineDeps,
  params: WritePipelineParams
): Promise<WritePipelineResult> {
  const { tenantId, userId, sessionId, message, isRetry } = params;

  // ── Stage 1: Rule filter (Ch 05.1) ────────────────────────────────────
  const filterResult = ruleFilter(message);

  if (filterResult.action === 'reject') {
    throw injectionDetected();
  }

  if (filterResult.action === 'forget') {
    const outcome = await deps.governanceEngine.applyForget({
      tenantId, userId, entityHint: filterResult.entity_hint,
    });
    // ⚠️ Ch 10.5 documents no dedicated response shape for a forget
    // command — only processed/no_memory/queued are specified. Smallest
    // extension consistent with the existing ProcessStatus union (shipped
    // in shared-types): reuse 'processed', report the affected row count
    // as `memoriesUpdated`, and return an empty memories array (no new
    // row was created). Confirm before relying on this in the SDK.
    return {
      status: 'processed',
      memoriesCreated: 0,
      memoriesUpdated: outcome.rowsAffected,
      memories: [],
    };
  }

  // ── Stage 2: Memory Intelligence LLM + validation/repair (Ch 04.3–04.4) ─
  let extraction: ExtractionSuccess | null;
  try {
    extraction = await attemptExtraction(deps, message);
  } catch (err) {
    // LLMAdapterChain (Ch 31.2) only throws once BOTH primary and fallback
    // are exhausted — any throw here means total provider outage (Ch 04,
    // AMM1004). Never surface this as an error to the caller; queue instead.
    console.error(JSON.stringify({
      event: 'llm_extraction_failed',
      error_name: err instanceof Error ? err.name : 'UnknownError',
      error_message: err instanceof Error ? err.message : String(err),
    }));
    void (err instanceof LLMAdapterError); // narrow for future branching if needed
    if (!isRetry) {
      await deps.pendingRepo.enqueue({ tenantId, userId, sessionId, message });
    }
    return { status: 'queued', memoriesCreated: 0, memoriesUpdated: 0, memories: [], queuedMessage: QUEUED_MESSAGE };
  }

  if (extraction === null) {
    // Validation failed even after repair (AMM1003) — dead-letter, never drop.
    if (!isRetry) {
      await deps.pendingRepo.enqueue({ tenantId, userId, sessionId, message });
    }
    return { status: 'queued', memoriesCreated: 0, memoriesUpdated: 0, memories: [], queuedMessage: QUEUED_MESSAGE };
  }

  if (!extraction.contains_memory || extraction.memories.length === 0) {
    return { status: 'no_memory', memoriesCreated: 0, memoriesUpdated: 0, memories: [] };
  }

  // ── Stage 3: Per-memory embed → governance (Ch 05.5, 06.2) ─────────────
  // Embedding happens BEFORE governance — see the reconciliation note at
  // the top of governance-repository.ts for why this differs from Ch 04.8's
  // stated step order while still preserving its promised behavior.
  let memoriesCreated = 0;
  let memoriesUpdated = 0;
  const summaries: ProcessedMemorySummary[] = [];

  for (const mem of extraction.memories) {
    let embedding: number[] | null = null;
    try {
      const [vec] = await deps.embedding.embed([mem.memory_text]);
      embedding = vec ?? null;
    } catch {
      // Graceful degradation (Ch 05.5) — store with null embedding,
      // the embedding-backfill cron (Ch 04.8) fills it in later.
      embedding = null;
    }

    const outcome = await deps.governanceEngine.apply({ tenantId, userId, mem, embedding });
    if (outcome === null) continue; // dropped: hypothetical certainty (Ch 05.2 gap)

    switch (outcome.rule) {
      case 'rule_1_replacement':
        memoriesCreated++;
        memoriesUpdated++; // the prior active row was archived in the same call
        summaries.push(toSummary(outcome.memory, 1));
        break;
      case 'no_rule_new_entity':
      case 'rule_2_tentative':
      case 'multi_value_insert':
        memoriesCreated++;
        summaries.push(toSummary(outcome.memory, 0));
        break;
      case 'rule_3_departure':
        if (outcome.superseded) memoriesUpdated++;
        break; // no new row — nothing to summarize
      case 'rule_4_correction':
        if (outcome.superseded) memoriesUpdated++; // `superseded` here means "rows affected > 0"
        break;
    }
  }

  return {
    status: 'processed',
    memoriesCreated,
    memoriesUpdated,
    memories: summaries,
  };
}
