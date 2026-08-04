import type { EmbeddingAdapter } from '@adaprio/shared-types';
import type { CloudflareAiBinding } from '../cloudflare-ai-binding.js';

/**
 * Embedding generation (Ch 04.6, 05.5). No fallback model — "Embedding
 * generation is not on the user-facing critical path" (Ch 04.6), so a
 * single provider is sufficient; failure is handled by the write pipeline
 * (null embedding + backfill cron), not by provider failover here.
 *
 * ⚠️ CONFIDENCE FLAG: the exact request/response shape for
 * `@cf/qwen/qwen3-embedding-0.6b` via `env.AI.run()` is inferred from the
 * general pattern Workers AI text-embedding models have historically used
 * (`{ text: string[] }` in, `{ shape, data: number[][] }` out) — the same
 * shape as Cloudflare's BGE embedding models. This has not been verified
 * against live documentation for this specific model. If the actual
 * response shape differs, this file is the only place that needs to
 * change — `EmbeddingAdapter` callers are unaffected.
 */

interface CloudflareEmbeddingResult {
  shape?: number[];
  data?: number[][];
}

export interface CloudflareAIEmbeddingAdapterConfig {
  binding: CloudflareAiBinding;
  model?: string;
}

export class CloudflareAIEmbeddingAdapter implements EmbeddingAdapter {
  readonly name = 'cloudflare-ai-embedding';
  readonly dimension = 1024; // Ch 04.6 — Qwen3-Embedding-0.6B native dim

  private readonly binding: CloudflareAiBinding;
  private readonly model: string;

  constructor(config: CloudflareAIEmbeddingAdapterConfig) {
    this.binding = config.binding;
    this.model = config.model ?? '@cf/qwen/qwen3-embedding-0.6b';
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const result = (await this.binding.run(this.model, { text: texts })) as CloudflareEmbeddingResult;

    if (!result?.data || !Array.isArray(result.data)) {
      throw new Error(
        `Unexpected response shape from ${this.model} — expected { data: number[][] }, got: ${JSON.stringify(result)}`
      );
    }
    if (result.data.length !== texts.length) {
      throw new Error(
        `Embedding count mismatch: sent ${texts.length} texts, got ${result.data.length} vectors back from ${this.model}`
      );
    }

    return result.data;
  }

  async ping(): Promise<boolean> {
    try {
      const [vec] = await this.embed(['ping']);
      return Array.isArray(vec) && vec.length === this.dimension;
    } catch {
      return false;
    }
  }
}
