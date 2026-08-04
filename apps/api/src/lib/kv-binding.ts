/**
 * Minimal structural type for a Workers KV binding. The real type comes
 * from `@cloudflare/workers-types` in the actual deployed project — this
 * local stub exists only so rate-limit.ts can be type-checked without
 * that package installed (same rationale as cloudflare-ai-binding.ts).
 */
export interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}
