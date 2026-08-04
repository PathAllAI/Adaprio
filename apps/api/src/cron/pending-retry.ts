import type { PendingRepository } from '../repositories/pending-repository.js';
import { runWritePipeline } from '../pipeline/write.js';
import type { WritePipelineDeps } from '../pipeline/write.js';

const BATCH_SIZE = 50; // Ch 04.8

export interface PendingRetryResult {
  claimed: number;
  processed: number;
  failed: number;
}

/**
 * Claims a batch of `pending_memory_events` (via `claim_pending_batch`,
 * migration 010, proposed) and re-runs the full write pipeline for each.
 * `isRetry: true` (see the note on `WritePipelineParams` in
 * pipeline/write.ts) suppresses the pipeline's normal enqueue-on-failure
 * behavior — a message still failing on retry gets `markFailed` on the
 * SAME row via `pendingRepo`, not a second duplicate row.
 */
export async function runPendingRetry(
  writeDeps: WritePipelineDeps,
  pendingRepo: PendingRepository
): Promise<PendingRetryResult> {
  const claimed = await pendingRepo.claimBatch(BATCH_SIZE);

  let processed = 0;
  let failed = 0;

  for (const row of claimed) {
    try {
      const result = await runWritePipeline(writeDeps, {
        tenantId: row.tenant_id,
        userId: row.user_id,
        sessionId: row.session_id ?? undefined,
        message: row.message,
        isRetry: true,
      });

      if (result.status === 'queued') {
        // Still failing — record the attempt. mark_pending_failed
        // (migration 010) increments `attempts` and flips to `failed`
        // once `max_attempts` is reached (Ch 04.8: up to 3 attempts).
        await pendingRepo.markFailed(row.id, 'Extraction still failing on retry');
        failed++;
      } else {
        await pendingRepo.markProcessed(row.id);
        processed++;
      }
    } catch (err) {
      await pendingRepo.markFailed(row.id, err instanceof Error ? err.message : 'Unknown error during retry');
      failed++;
    }
  }

  return { claimed: claimed.length, processed, failed };
}
