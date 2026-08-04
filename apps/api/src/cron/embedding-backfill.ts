import type { EmbeddingAdapter } from '@adaprio/shared-types';
import type { MemoryRepository } from '../repositories/memory-repository.js';

const BATCH_SIZE = 10; // Ch 04.8

export interface EmbeddingBackfillResult {
  attempted: number;
  succeeded: number;
  failed: number;
}

/**
 * Finds memories with `embedding IS NULL` (Ch 05.5's graceful-degradation
 * promise — see the reconciliation note in governance-repository.ts for
 * why rows can end up in this state) and fills them in. Failures are
 * logged and skipped, not retried within this run — they'll be picked up
 * again on the next 30-minute tick (Ch 04.8), which is safe because
 * `find_missing_embeddings` (migration 016) only returns rows still
 * missing an embedding.
 */
export async function runEmbeddingBackfill(
  memoryRepo: MemoryRepository,
  embedding: EmbeddingAdapter
): Promise<EmbeddingBackfillResult> {
  const rows = await memoryRepo.findMissingEmbeddings(BATCH_SIZE);

  let succeeded = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const [vec] = await embedding.embed([row.memoryText]);
      await memoryRepo.updateEmbedding(row.id, vec);
      succeeded++;
    } catch {
      // Left for the next tick — see file header comment.
      failed++;
    }
  }

  return { attempted: rows.length, succeeded, failed };
}
