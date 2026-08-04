import type { RerankerAdapter } from '@adaprio/shared-types';

/**
 * ⚠️ NOT explicitly named in Ch 31 (which names `LLMAdapterChain` but
 * describes the reranker fallback only as prose in Ch 04.7/07.4: "HF
 * Qwen3-Reranker-0.6B → timeout/5xx → Cloudflare AI BGE-Reranker-Base").
 * This class is the smallest extension consistent with that documented
 * behavior, mirroring `LLMAdapterChain`'s shape. `RerankerAdapter` has no
 * typed error class the way `LLMAdapter` has `LLMAdapterError` (Ch 31.3
 * defines no equivalent) — so this chain has no `retryable` distinction to
 * make and simply tries each adapter in order, falling through on ANY
 * thrown error, then rethrowing the last one if all are exhausted.
 * `pipeline/read.ts` catches that final throw and degrades to vector-
 * similarity ordering (Ch 07.4's documented last resort) — this class does
 * not implement that fallback itself, only the HF → Cloudflare AI hop.
 */
export class RerankerAdapterChain implements RerankerAdapter {
  readonly name = 'reranker-chain';

  private readonly adapters: RerankerAdapter[];

  constructor(adapters: RerankerAdapter[]) {
    if (adapters.length === 0) {
      throw new Error('RerankerAdapterChain requires at least one adapter');
    }
    this.adapters = adapters;
  }

  async rerank(query: string, documents: string[], options?: { timeoutMs?: number }): Promise<number[]> {
    let lastError: unknown;
    for (const adapter of this.adapters) {
      try {
        return await adapter.rerank(query, documents, options);
      } catch (err) {
        lastError = err;
        // no retryable distinction available — always try the next adapter
      }
    }
    throw lastError instanceof Error ? lastError : new Error('RerankerAdapterChain: all adapters failed');
  }

  async ping(): Promise<boolean> {
    const results = await Promise.all(this.adapters.map((a) => a.ping().catch(() => false)));
    return results.some(Boolean);
  }
}
