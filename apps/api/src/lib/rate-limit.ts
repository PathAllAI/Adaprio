import type { KVNamespaceLike } from './kv-binding.js';

/**
 * ⚠️ CORRECTION FROM THE HANDBOOK, not a silent substitution: Ch 10.7
 * describes the rate limit key as a plain `<tenant_id>:write` string "with
 * a 60-second TTL window" in KV, implying: increment a counter at that key,
 * relying on `expirationTtl` to reset it. That literal approach has a real
 * bug — `put(key, value, { expirationTtl })` resets the TTL countdown on
 * EVERY write, not just the first. Under sustained traffic, a tenant that
 * ever reaches the limit would never see the key expire (each increment
 * pushes expiry another `expirationTtl` seconds into the future), so the
 * limit would become permanent instead of resetting every 60 seconds.
 *
 * Fix used here: key includes the fixed window's start timestamp
 * (`<tenant_id>:<op>:<windowStart>`), so the TTL is set once when a window
 * first sees traffic and never extended by later increments within that
 * same window — a new key (and a fresh TTL) only appears once the clock
 * moves into the next 60-second bucket.
 *
 * Two known limitations remain, inherent to using plain KV rather than a
 * strongly-consistent counter (e.g. a Durable Object) — not fixed here
 * because switching primitives would be a bigger architectural change than
 * this file should make unprompted:
 *   1. Fixed-window inaccuracy: a burst spanning a window boundary can let
 *      up to ~2x the configured limit through in a short span. A sliding-
 *      window or token-bucket algorithm would need per-request timestamps,
 *      which plain KV counters can't cheaply support.
 *   2. No atomic increment: `get` then `put` is a read-modify-write with a
 *      race window, and KV itself is only eventually consistent across
 *      Cloudflare's edge locations — two near-simultaneous requests at
 *      different PoPs can both read the same count and both proceed,
 *      slightly under-enforcing the limit. Acceptable for the "protect
 *      against abuse," not "bill precisely," use case Ch 10.7 describes;
 *      flagged in case precise enforcement is actually required.
 */

const WINDOW_SECONDS = 60;

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Unix seconds — when the current window resets. Ch 10.4's `X-RateLimit-Reset` header value. */
  resetAt: number;
}

export type RateLimitOperation = 'write' | 'retrieve';

/**
 * Checks and increments the rate limit counter for one tenant + operation.
 * Does not throw — the route layer (not yet built) decides whether to
 * throw `rateLimited()` based on `result.allowed`, and attaches the
 * `X-RateLimit-*` headers (Ch 10.4) from this result on every response,
 * allowed or not.
 */
export async function checkRateLimit(
  kv: KVNamespaceLike,
  tenantId: string,
  operation: RateLimitOperation,
  limit: number
): Promise<RateLimitResult> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const windowStart = nowSeconds - (nowSeconds % WINDOW_SECONDS);
  const resetAt = windowStart + WINDOW_SECONDS;
  const key = `${tenantId}:${operation}:${windowStart}`;

  const raw = await kv.get(key);
  const count = raw ? parseInt(raw, 10) : 0;

  if (count >= limit) {
    return { allowed: false, limit, remaining: 0, resetAt };
  }

  // TTL covers only the remainder of the current window (plus a small
  // buffer for clock skew between the Worker and KV's storage layer) —
  // not a full 60s from "now," since the window itself started earlier.
  const ttl = Math.max(60, resetAt - nowSeconds + 5);
  await kv.put(key, String(count + 1), { expirationTtl: ttl });

  return { allowed: true, limit, remaining: limit - count - 1, resetAt };
}
