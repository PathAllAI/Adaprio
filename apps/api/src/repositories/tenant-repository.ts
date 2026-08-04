import type { DatabaseAdapter } from '@adaprio/shared-types';

/**
 * ⚠️ NOT one of the four repositories Ch 9.9 names (memory/governance/
 * event/pending). `amm_tenants` (migration 009) is a different kind of
 * data — Adaprio's own account/billing data, not customer memory data —
 * and Ch 33.1.2 doesn't list a tenant-repository.ts either. Added here for
 * the same reason `select`/`insert`/`update` were added to `DatabaseAdapter`
 * itself: `src/lib/auth.ts` needs a lookup that has nowhere else to live,
 * and Ch 9.9's own rule ("repositories are the only place supabase.from()
 * is called") argues for a repository here too, not a raw adapter call
 * from lib/. Confirm this file's existence and location, or move it if a
 * different home is preferred.
 */

export interface TenantRow {
  id: string;
  org_name: string;
  api_key_prefix: string;
  api_key_hash: string;
  rate_limit_tier: string;
  rate_limit_writes_per_min: number;
  rate_limit_retrievals_per_min: number;
  dedicated_region: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface TenantMemoryStats {
  total_memories: number;
  active_memories: number;
  historical_memories: number;
  expired_memories: number;
  deleted_memories: number;
  writes_this_period: number;
  feedback_total: number;
  feedback_negative: number;
}

export class TenantRepository {
  constructor(private readonly db: DatabaseAdapter) {}

  /**
   * Looks up an active tenant by API key hash. Returns `null` for no match
   * OR a match with `status !== 'active'` (suspended/cancelled tenants
   * must authenticate identically to a wrong key — Ch 14, no information
   * leak about account status via a different error path).
   */
  async findActiveByApiKeyHash(apiKeyHash: string): Promise<TenantRow | null> {
    const rows = await this.db.select<TenantRow>({
      table: 'amm_tenants',
      filters: { api_key_hash: apiKeyHash, status: 'active' },
      limit: 1,
    });
    return rows[0] ?? null;
  }

  /**
   * Backed by `get_tenant_memory_stats` (migration 014, proposed). Only
   * the computable subset of Ch 10.5's MetricsResponse — see that
   * migration's header comment for exactly which fields this covers and
   * which four fields (retrievals_this_period, avg_write_latency_ms,
   * avg_retrieval_latency_ms, memory_found_rate) have no Postgres-side
   * source at all under the current architecture.
   */
  async getMemoryStats(params: { tenantId: string; periodStart: string; periodEnd: string }): Promise<TenantMemoryStats> {
    const rows = await this.db.rpc<TenantMemoryStats[]>('get_tenant_memory_stats', {
      p_tenant_id: params.tenantId,
      p_period_start: params.periodStart,
      p_period_end: params.periodEnd,
    });
    const row = rows[0];
    if (!row) {
      throw new Error('get_tenant_memory_stats returned no rows — expected exactly one aggregate row');
    }
    return row;
  }
}
