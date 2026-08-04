import type { LLMAdapter, LLMResponse } from '@adaprio/shared-types';
import { LLMAdapterError } from '@adaprio/shared-types';

/**
 * Wraps two or more LLMAdapter implementations with transparent failover
 * (Ch 31.2). On a retryable LLMAdapterError from one adapter, tries the
 * next. On a non-retryable error (malformed request — retrying elsewhere
 * would fail identically) or after the last adapter fails, rethrows.
 *
 * `pipeline/write.ts` only throws-to-queue when THIS class throws — by the
 * time that happens, every configured provider has already been tried.
 */
export class LLMAdapterChain implements LLMAdapter {
  readonly name = 'llm-chain';

  private readonly adapters: LLMAdapter[];

  constructor(adapters: LLMAdapter[]) {
    if (adapters.length === 0) {
      throw new Error('LLMAdapterChain requires at least one adapter');
    }
    this.adapters = adapters;
  }

  async extract(systemPrompt: string, userMessage: string, options?: { timeoutMs?: number }): Promise<LLMResponse> {
    for (let i = 0; i < this.adapters.length; i++) {
      const isLast = i === this.adapters.length - 1;
      try {
        return await this.adapters[i].extract(systemPrompt, userMessage, options);
      } catch (err) {
        const retryable = err instanceof LLMAdapterError ? err.retryable : true;
        if (isLast || !retryable) throw err;
        // else: fall through to the next adapter in the chain
      }
    }
    // Unreachable — the loop above always either returns or throws — but
    // TypeScript's control-flow analysis can't see that, so this satisfies
    // the "must return LLMResponse on every path" requirement.
    throw new LLMAdapterError('NETWORK', 'LLMAdapterChain exhausted with no adapters configured', false);
  }

  async ping(): Promise<boolean> {
    const results = await Promise.all(this.adapters.map((a) => a.ping().catch(() => false)));
    return results.some(Boolean);
  }
}
