import type { GovernanceRepository } from '../repositories/governance-repository.js';

const BATCH_SIZE = 500; // Ch 27.6

export interface TtlSweepResult {
  expiredCount: number;
}

/**
 * Transitions `lifecycle_state = 'active'` memories past their
 * `expires_at` to `expired` (Ch 04.8, 27.6). The trigger
 * (`trg_log_memory_event`, migration 006/011) automatically logs an
 * `EXPIRE` event per row — this function does not write to `memory_events`
 * itself.
 */
export async function runTtlSweep(governanceRepo: GovernanceRepository): Promise<TtlSweepResult> {
  const expired = await governanceRepo.sweepExpired(BATCH_SIZE);
  return { expiredCount: expired.length };
}
