import type { TenantRepository, TenantRow } from '../repositories/tenant-repository.js';
import { unauthorized } from './errors.js';

/**
 * ⚠️ CORRECTION FROM THE HANDBOOK, not a silent substitution: Ch 14.2 and
 * the migration 009 header comment both specify bcrypt (cost factor 12)
 * for API key hashing. bcrypt is not practically usable in the Cloudflare
 * Workers runtime — there is no native bcrypt binding (Workers isolates
 * cannot load native/compiled code), and a pure-JS bcrypt implementation
 * (e.g. bcryptjs) at cost factor 12 runs for hundreds of milliseconds to
 * seconds per hash, which blows through both the write-pipeline latency
 * budget (Ch 29: < 600ms P99 total) and Workers' own CPU-time limits on
 * every single request, not just occasionally.
 *
 * Resolution used here: SHA-256 of `apiKey + pepper` via the Web Crypto
 * API (`crypto.subtle`), which IS natively available in Workers, adds
 * negligible latency, and needs no npm dependency. This is a defensible
 * substitution specifically BECAUSE API keys — unlike user passwords —
 * are long, server-generated, high-entropy random tokens: bcrypt's slow-
 * hash design exists to defend low-entropy human-chosen secrets against
 * offline brute force, a threat model that doesn't apply to a 256-bit
 * random token. A fast hash plus a server-side pepper (never stored in
 * the database, only in Worker Secrets) is standard practice for API-key
 * verification at companies with comparable architectures.
 *
 * The pepper is a NEW secret this introduces beyond the five listed in
 * Ch 17.8/17.9 (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `GROQ_API_KEY`,
 * `HF_API_KEY`, `ENCRYPTION_KEY`) — call it `API_KEY_PEPPER`, set the same
 * way (`wrangler secret put API_KEY_PEPPER --env <environment>`).
 *
 * Migration 009's comment also cites "Chapter 23.7" for this hashing
 * approach — Ch 23.7 is actually "Incident Response," not authentication.
 * That reference appears to be a mistake in the migration file; the real
 * source for bcrypt is Ch 14.2. Flagging in case the intended chapter was
 * different content that never got written.
 */

export interface TenantContext {
  tenantId: string;
  orgName: string;
  rateLimitTier: string;
  writesPerMin: number;
  retrievalsPerMin: number;
}

async function hashApiKey(apiKey: string, pepper: string): Promise<string> {
  const data = new TextEncoder().encode(apiKey + pepper);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function toTenantContext(row: TenantRow): TenantContext {
  return {
    tenantId: row.id,
    orgName: row.org_name,
    rateLimitTier: row.rate_limit_tier,
    writesPerMin: row.rate_limit_writes_per_min,
    retrievalsPerMin: row.rate_limit_retrievals_per_min,
  };
}

/**
 * Extracts and validates the `Authorization: Bearer <api_key>` header
 * (Ch 10.1), hashes the key, and looks up the owning tenant. Throws
 * `ApiError` (UNAUTHORIZED, 401) for: missing header, malformed header,
 * a key not prefixed `amm_`, or no active tenant matching the hash. The
 * same error is thrown for all four cases deliberately — Ch 14's no-
 * information-leak principle means a malformed key and a suspended
 * account must be indistinguishable to the caller.
 */
export async function authenticateRequest(
  request: Request,
  deps: { tenantRepo: TenantRepository; apiKeyPepper: string }
): Promise<TenantContext> {
  const header = request.headers.get('Authorization');
  if (!header) throw unauthorized();

  const match = /^Bearer\s+(.+)$/.exec(header);
  if (!match) throw unauthorized();

  const apiKey = match[1].trim();
  if (!apiKey.startsWith('amm_')) throw unauthorized();

  const hash = await hashApiKey(apiKey, deps.apiKeyPepper);
  const tenant = await deps.tenantRepo.findActiveByApiKeyHash(hash);
  if (!tenant) throw unauthorized();

  return toTenantContext(tenant);
}
