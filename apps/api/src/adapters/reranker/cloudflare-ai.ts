import type { RerankerAdapter } from '@adaprio/shared-types';
import type { CloudflareAiBinding } from '../cloudflare-ai-binding.js';

/**
 * Fallback reranker (Ch 04.7: activates on HF timeout > 3s, HTTP 5xx, or
 * rate limit).
 *
 * ⚠️ CONFIDENCE FLAG: response shape inferred from Cloudflare's documented
 * pattern for reranker-family models — `{ query, contexts: [{ text }] }`
 * in, `{ response: [{ id, score }] }` out, where `id` is the index into
 * `contexts`. Not verified against live docs for `@cf/baai/bge-reranker-base`
 * specifically. If the actual shape differs, only `rerank()` needs to change.
 */

interface CloudflareRerankResponseItem {
  id: number;
  score: number;
}

interface CloudflareRerankResult {
  response?: CloudflareRerankResponseItem[];
}

export interface CloudflareAIRerankerAdapterConfig {
  binding: CloudflareAiBinding;
  model?: string;
}

export class CloudflareAIRerankerAdapter implements RerankerAdapter {
  readonly name = 'cloudflare-ai-reranker';

  private readonly binding: CloudflareAiBinding;
  private readonly model: string;

  constructor(config: CloudflareAIRerankerAdapterConfig) {
    this.binding = config.binding;
    this.model = config.model ?? '@cf/baai/bge-reranker-base'; // Ch 04.7
  }

  async rerank(query: string, documents: string[]): Promise<number[]> {
    if (documents.length === 0) return [];

    const result = (await this.binding.run(this.model, {
      query,
      contexts: documents.map((text) => ({ text })),
    })) as CloudflareRerankResult;

    if (!result?.response || !Array.isArray(result.response)) {
      throw new Error(
        `Unexpected response shape from ${this.model} — expected { response: [{ id, score }] }, got: ${JSON.stringify(result)}`
      );
    }

    const scores = new Array<number>(documents.length).fill(0);
    for (const item of result.response) {
      if (item.id >= 0 && item.id < scores.length) {
        scores[item.id] = item.score;
      }
    }
    return scores;
  }

  async ping(): Promise<boolean> {
    try {
      const scores = await this.rerank('ping', ['ping document']);
      return scores.length === 1;
    } catch {
      return false;
    }
  }
}
