/**
 * Minimal structural type for `env.AI` (the Workers AI binding). The real
 * type comes from `@cloudflare/workers-types` in the actual deployed
 * project — this local stub exists only so the adapters in this directory
 * can be type-checked without that package installed. Once
 * `@cloudflare/workers-types` is added to apps/api's devDependencies,
 * prefer importing the real `Ai` type and delete this file.
 */
export interface CloudflareAiBinding {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}
