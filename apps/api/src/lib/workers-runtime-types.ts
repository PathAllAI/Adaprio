/**
 * Minimal structural types for the Cloudflare Workers runtime signatures
 * (`fetch(request, env, ctx)`, `scheduled(controller, env, ctx)`). The real
 * types come from `@cloudflare/workers-types` — same rationale as the
 * other local stubs in this codebase (cloudflare-ai-binding.ts,
 * kv-binding.ts, supabase-client-types.ts).
 */
export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export interface ScheduledController {
  cron: string;
  scheduledTime: number;
}
