import type { RerankerAdapter } from '@adaprio/shared-types';

/**
 * Primary reranker (Ch 04.7, 07.4). Scores (query, document) pairs.
 *
 * ⚠️ CONFIDENCE FLAG — the highest-uncertainty adapter in this directory.
 * Cross-encoder reranker models on HF Inference API have historically been
 * exposed via the "sentence-similarity" task shape
 * (`{ inputs: { source_sentence, sentences } }` → `number[]` of scores,
 * same order as `sentences`), which is what this adapter targets. Qwen3-
 * Reranker-0.6B is new enough that I cannot confirm this is how HF exposes
 * it specifically (a reranker is not quite the same task as symmetric
 * sentence-similarity, even though the wire shape may be identical). If
 * this doesn't match reality, the `rerank()` method body — not the
 * `RerankerAdapter` interface — is what needs to change.
 */

export interface HuggingFaceRerankerAdapterConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

export class HuggingFaceRerankerAdapter implements RerankerAdapter {
  readonly name = 'huggingface-reranker';

  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(config: HuggingFaceRerankerAdapterConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'Qwen/Qwen3-Reranker-0.6B'; // Ch 04.7
    this.baseUrl = config.baseUrl ?? 'https://api-inference.huggingface.co/models';
  }

  async rerank(query: string, documents: string[], options?: { timeoutMs?: number }): Promise<number[]> {
    if (documents.length === 0) return [];

    const timeoutMs = options?.timeoutMs ?? 3000; // Ch 25-C RERANKER_TIMEOUT_MS default
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/${this.model}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          inputs: { source_sentence: query, sentences: documents },
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      throw new Error(
        err instanceof Error && err.name === 'AbortError'
          ? `Hugging Face reranker request exceeded ${timeoutMs}ms`
          : `Hugging Face reranker request failed: ${(err as Error).message}`
      );
    }
    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`Hugging Face reranker request failed: HTTP ${response.status}`);
    }

    const scores = (await response.json()) as unknown;
    if (!Array.isArray(scores) || scores.length !== documents.length || !scores.every((s) => typeof s === 'number')) {
      throw new Error(
        `Unexpected response shape from ${this.model} — expected number[] of length ${documents.length}, got: ${JSON.stringify(scores)}`
      );
    }

    return scores as number[];
  }

  async ping(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/${this.model}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return response.ok || response.status === 503; // 503 = model loading, still "reachable"
    } catch {
      return false;
    }
  }
}
