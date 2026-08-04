import type { DatabaseAdapter, EmbeddingAdapter, LLMAdapter, RerankerAdapter } from '@adaprio/shared-types';
import { GroqLLMAdapter } from './llm/groq.js';
import { HuggingFaceLLMAdapter } from './llm/huggingface.js';
import { LLMAdapterChain } from './llm/chain.js';
import { CloudflareAIEmbeddingAdapter } from './embedding/cloudflare-ai.js';
import { HuggingFaceRerankerAdapter } from './reranker/huggingface.js';
import { CloudflareAIRerankerAdapter } from './reranker/cloudflare-ai.js';
import { RerankerAdapterChain } from './reranker/chain.js';
import { SupabaseAdapter } from './database/supabase.js';
import type { CloudflareAiBinding } from './cloudflare-ai-binding.js';
import type { SupabaseClientLike } from './database/supabase-client-types.js';

export * from './llm/groq.js';
export * from './llm/huggingface.js';
export * from './llm/chain.js';
export * from './llm/mock.js';
export * from './embedding/cloudflare-ai.js';
export * from './embedding/mock.js';
export * from './reranker/huggingface.js';
export * from './reranker/cloudflare-ai.js';
export * from './reranker/chain.js';
export * from './reranker/mock.js';
export * from './database/supabase.js';
export * from './database/mock.js';
export * from './cloudflare-ai-binding.js';
export * from './database/supabase-client-types.js';

export interface Adapters {
  llm: LLMAdapter;
  embedding: EmbeddingAdapter;
  reranker: RerankerAdapter;
  database: DatabaseAdapter;
  /**
   * ⚠️ ADDED beyond the Ch 31.6 sketch: `llm` and `reranker` above are
   * fallback chains exposing only one aggregate `ping()` each ("healthy if
   * ANY adapter in the chain is reachable" — see chain.ts). Ch 10.5's
   * health response needs `llm_primary`/`llm_fallback`/`reranker_primary`/
   * `reranker_fallback` as four INDEPENDENT statuses, which a chain
   * structurally cannot report. This bundle exposes the individual
   * providers for routes/health.ts to ping separately — it is not used
   * anywhere on the write/read critical path, only for health reporting.
   */
  healthCheckProviders: {
    llmPrimary: LLMAdapter;
    llmFallback: LLMAdapter;
    rerankerPrimary: RerankerAdapter;
    rerankerFallback: RerankerAdapter;
  };
}

export interface BuildAdaptersConfig {
  groqApiKey: string;
  hfApiKey: string;
  cloudflareAiBinding: CloudflareAiBinding;
  supabaseClient: SupabaseClientLike;
  llmTimeoutMs?: number;
  rerankerTimeoutMs?: number;
}

/**
 * Wires the concrete providers together (Ch 31.6). Called once at Worker
 * cold start in src/index.ts (not yet built), then passed into every
 * pipeline/route call for the lifetime of that Worker instance. This is
 * the ONLY place in apps/api that should construct a concrete adapter
 * class directly — everywhere else depends on the `Adapters` interface,
 * consistent with the ports-and-adapters boundary the whole engine/
 * and pipeline/ layer was built against.
 */
export function buildAdapters(config: BuildAdaptersConfig): Adapters {
  const groqAdapter = new GroqLLMAdapter({ apiKey: config.groqApiKey });
  const hfLlmAdapter = new HuggingFaceLLMAdapter({ apiKey: config.hfApiKey });
  const llm = new LLMAdapterChain([groqAdapter, hfLlmAdapter]);

  const embedding = new CloudflareAIEmbeddingAdapter({ binding: config.cloudflareAiBinding });

  const hfRerankerAdapter = new HuggingFaceRerankerAdapter({ apiKey: config.hfApiKey });
  const cfRerankerAdapter = new CloudflareAIRerankerAdapter({ binding: config.cloudflareAiBinding });
  const reranker = new RerankerAdapterChain([hfRerankerAdapter, cfRerankerAdapter]);

  const database = new SupabaseAdapter({ client: config.supabaseClient });

  return {
    llm,
    embedding,
    reranker,
    database,
    healthCheckProviders: {
      llmPrimary: groqAdapter,
      llmFallback: hfLlmAdapter,
      rerankerPrimary: hfRerankerAdapter,
      rerankerFallback: cfRerankerAdapter,
    },
  };
}
