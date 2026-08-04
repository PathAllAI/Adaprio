/**
 * Adaprio AMM Worker — entry point (Ch 04, 17.2). This is the file
 * `wrangler.toml`'s `main = "src/index.ts"` points to. It has two jobs:
 * route incoming HTTP requests (`fetch`) to the right handler, and
 * dispatch scheduled cron ticks (`scheduled`) to the right job. All actual
 * logic lives in engine/, pipeline/, routes/, and cron/ — this file only
 * wires dependencies together and dispatches.
 */

import { createClient } from '@supabase/supabase-js';
import { buildAdapters } from './adapters/index.js';
import type { Adapters } from './adapters/index.js';
import type { CloudflareAiBinding } from './adapters/cloudflare-ai-binding.js';
import type { KVNamespaceLike } from './lib/kv-binding.js';
import type { ExecutionContext, ScheduledController } from './lib/workers-runtime-types.js';
import {
  GovernanceRepository,
  MemoryRepository,
  EventRepository,
  PendingRepository,
  TenantRepository,
  FeedbackRepository,
} from './repositories/index.js';
import { GovernanceEngine } from './engine/governance.js';
import { handleProcess, handleRetrieve, handleFeedback, handleHealth, handleMetrics } from './routes/index.js';
import { runTtlSweep, runPendingRetry, runEmbeddingBackfill } from './cron/index.js';
import type { WritePipelineDeps } from './pipeline/write.js';
import { buildExtractionSystemPrompt } from './prompts/extraction-v1.0.0.js';
import { buildRepairMessage } from './prompts/repair-v1.0.0.js';
import { getOrCreateRequestId, errorToResponse, jsonResponse } from './lib/http.js';

const API_VERSION = '1.0.0';

// ── Env — must match wrangler.toml exactly (bindings + vars + secrets) ────

export interface Env {
  // Bindings (wrangler.toml [ai] / [[kv_namespaces]])
  AI: CloudflareAiBinding;
  RATE_LIMIT_KV: KVNamespaceLike;

  // Vars (wrangler.toml [vars] — always strings, parsed below)
  ENVIRONMENT: string;
  LOG_LEVEL: string;
  MIN_CONFIDENCE: string;
  MAX_RETRIEVAL_RESULTS: string;
  LLM_TIMEOUT_MS: string;
  RERANKER_TIMEOUT_MS: string;
  MAX_PENDING_ATTEMPTS: string;

  // Secrets (Ch 17.8/17.9, plus API_KEY_PEPPER — see lib/auth.ts's note)
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  GROQ_API_KEY: string;
  HF_API_KEY: string;
  ENCRYPTION_KEY: string;
  API_KEY_PEPPER: string;
}

// ── Dependency construction (Ch 17.2 — per-isolate singleton) ─────────────

/**
 * Workers isolates persist global/module scope across requests within the
 * same isolate (reset only on redeploy or eviction) but `env` is only
 * available INSIDE `fetch`/`scheduled`, not at true module top-level — so
 * expensive objects (HTTP clients, the Supabase client) are lazily built
 * on first use per isolate and cached here, rather than rebuilt on every
 * request. This is the standard Workers idiom for this constraint, not a
 * violation of Ch 04.1's "stateless instances, no coordination" — nothing
 * here is shared ACROSS instances, only reused within one instance's
 * lifetime as a performance optimization.
 */
let cached: {
  adapters: Adapters;
  tenantRepo: TenantRepository;
  memoryRepo: MemoryRepository;
  governanceRepo: GovernanceRepository;
  eventRepo: EventRepository;
  pendingRepo: PendingRepository;
  feedbackRepo: FeedbackRepository;
  governanceEngine: GovernanceEngine;
  writeDeps: WritePipelineDeps;
} | null = null;

function getDeps(env: Env) {
  if (cached) return cached;

  // ⚠️ `createClient` requires `@supabase/supabase-js` as a real installed
  // dependency (added to package.json) — this line could not be
  // type-checked against the real package in the environment this codebase
  // was built in (see database/supabase-client-types.ts's header note).
  // The client it returns is expected to satisfy `SupabaseClientLike`
  // structurally; verify once the real package is installed.
  const supabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

  const adapters = buildAdapters({
    groqApiKey: env.GROQ_API_KEY,
    hfApiKey: env.HF_API_KEY,
    cloudflareAiBinding: env.AI,
    supabaseClient,
    llmTimeoutMs: parseInt(env.LLM_TIMEOUT_MS, 10) || 5000,
    rerankerTimeoutMs: parseInt(env.RERANKER_TIMEOUT_MS, 10) || 3000,
  });

  const tenantRepo = new TenantRepository(adapters.database);
  const memoryRepo = new MemoryRepository(adapters.database);
  const governanceRepo = new GovernanceRepository(adapters.database);
  const eventRepo = new EventRepository(adapters.database);
  const pendingRepo = new PendingRepository(adapters.database);
  const feedbackRepo = new FeedbackRepository(adapters.database);
  const governanceEngine = new GovernanceEngine(governanceRepo, memoryRepo);

  const writeDeps: WritePipelineDeps = {
    llm: adapters.llm,
    embedding: adapters.embedding,
    governanceEngine,
    pendingRepo,
    extractionSystemPrompt: buildExtractionSystemPrompt(),
    buildRepairMessage,
  };

  cached = { adapters, tenantRepo, memoryRepo, governanceRepo, eventRepo, pendingRepo, feedbackRepo, governanceEngine, writeDeps };
  return cached;
}

// ── HTTP routing ────────────────────────────────────────────────────────

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;

  const deps = getDeps(env);
  const apiKeyPepper = env.API_KEY_PEPPER;

  if (method === 'POST' && pathname === '/v1/memory/process') {
    return handleProcess(request, {
      tenantRepo: deps.tenantRepo,
      rateLimitKv: env.RATE_LIMIT_KV,
      apiKeyPepper,
      writeDeps: deps.writeDeps,
    });
  }

  if (method === 'POST' && pathname === '/v1/memory/retrieve') {
    return handleRetrieve(request, {
      tenantRepo: deps.tenantRepo,
      rateLimitKv: env.RATE_LIMIT_KV,
      apiKeyPepper,
      readDeps: {
        embedding: deps.adapters.embedding,
        reranker: deps.adapters.reranker,
        memoryRepo: deps.memoryRepo,
        defaultMinConfidence: parseFloat(env.MIN_CONFIDENCE) || 0.4,
        defaultMaxResults: parseInt(env.MAX_RETRIEVAL_RESULTS, 10) || 10,
      },
    });
  }

  if (method === 'POST' && pathname === '/v1/feedback') {
    return handleFeedback(request, {
      tenantRepo: deps.tenantRepo,
      memoryRepo: deps.memoryRepo,
      feedbackRepo: deps.feedbackRepo,
      apiKeyPepper,
    });
  }

  if (method === 'GET' && pathname === '/v1/health') {
    return handleHealth({
      database: deps.adapters.database,
      embedding: deps.adapters.embedding,
      llmPrimary: deps.adapters.healthCheckProviders.llmPrimary,
      llmFallback: deps.adapters.healthCheckProviders.llmFallback,
      rerankerPrimary: deps.adapters.healthCheckProviders.rerankerPrimary,
      rerankerFallback: deps.adapters.healthCheckProviders.rerankerFallback,
      version: API_VERSION,
    });
  }

  if (method === 'GET' && pathname === '/v1/metrics') {
    return handleMetrics(request, { tenantRepo: deps.tenantRepo, apiKeyPepper });
  }

  const requestId = getOrCreateRequestId(request);
  return jsonResponse(
    { error: { code: 'INVALID_REQUEST', message: `No route for ${method} ${pathname}`, request_id: requestId } },
    404,
    { 'X-Request-ID': requestId }
  );
}

// ── Cron dispatch (Ch 04.8, 17.2) ──────────────────────────────────────

async function dispatchCron(controller: ScheduledController, env: Env): Promise<void> {
  const deps = getDeps(env);

  switch (controller.cron) {
    case '*/15 * * * *': {
      const result = await runTtlSweep(deps.governanceRepo);
      console.log(JSON.stringify({ event: 'ttl_sweep_complete', ...result }));
      break;
    }
    case '*/5 * * * *': {
      const result = await runPendingRetry(deps.writeDeps, deps.pendingRepo);
      console.log(JSON.stringify({ event: 'pending_retry_complete', ...result }));
      break;
    }
    case '*/30 * * * *': {
      const result = await runEmbeddingBackfill(deps.memoryRepo, deps.adapters.embedding);
      console.log(JSON.stringify({ event: 'embedding_backfill_complete', ...result }));
      break;
    }
    default:
      console.error(JSON.stringify({ event: 'unknown_cron_schedule', cron: controller.cron }));
  }
}

// ── Worker export ─────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    try {
      return await route(request, env);
    } catch (err) {
      // Last-resort catch — every route handler already catches internally
      // (Ch 10.10), so reaching here means something outside a handler's
      // own try/catch threw (e.g. getDeps() itself failing to construct
      // the Supabase client). Still shaped as a proper error response,
      // never a raw 500 with a stack trace leaked to the caller.
      return errorToResponse(err, getOrCreateRequestId(request));
    }
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(dispatchCron(controller, env));
  },
};
