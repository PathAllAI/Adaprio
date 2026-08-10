import type { CandidateMemory, DatabaseAdapter, MetadataSearchParams, VectorSearchParams } from '@adaprio/shared-types';
import type { SupabaseClientLike, SupabaseResult } from './supabase-client-types.js';

/**
 * ⚠️ REQUIRES A NEW MIGRATION, not yet in the migration set (001–011):
 * neither `vectorSearch` nor `metadataSearch` can be expressed through
 * Supabase's JS query builder — pgvector's `<=>` cosine-distance operator
 * (Ch 07.3: `ORDER BY embedding <=> $query_vector`) has no equivalent in
 * `.order()`, which only accepts a column name, not an expression. This is
 * the same class of gap as the pending-queue functions (migration 010):
 * something Ch 07.3 describes as a raw SQL query has no backing Postgres
 * function to call it through.
 *
 * Both methods below call ONE proposed function, `search_memories`, which
 * does vector search when a query vector is supplied and plain metadata
 * filtering (ordered by recency) when it is not — mirroring how
 * `insertTentative` and `applyMultiValueInsert` already share one function
 * for two call-sites (governance-repository.ts). Proposed SQL:
 *
 *   CREATE OR REPLACE FUNCTION search_memories(
 *     p_tenant_id uuid, p_user_id text, p_lifecycle_filter text[],
 *     p_limit integer, p_query_vector vector(1024) DEFAULT NULL,
 *     p_category_filter text[] DEFAULT NULL, p_entity_key text DEFAULT NULL
 *   ) RETURNS TABLE (
 *     id uuid, entity_key text, value text, memory_text text, certainty text,
 *     importance_score numeric, lifecycle_state text, last_confirmed_at timestamptz,
 *     valid_until timestamptz, retrieval_count integer, last_accessed timestamptz,
 *     reinforcement_score numeric, similarity_score double precision
 *   ) AS $$
 *   BEGIN
 *     IF p_query_vector IS NOT NULL THEN
 *       RETURN QUERY
 *         SELECT m.id, m.entity_key, m.value, m.memory_text, m.certainty::text,
 *                m.importance_score, m.lifecycle_state::text, m.last_confirmed_at, m.valid_until,
 *                m.retrieval_count, m.last_accessed, m.reinforcement_score,
 *                (1 - (m.embedding <=> p_query_vector))::double precision
 *         FROM memories m
 *         WHERE m.tenant_id = p_tenant_id AND m.user_id = p_user_id
 *           AND m.lifecycle_state::text = ANY(p_lifecycle_filter)
 *           AND (p_category_filter IS NULL OR m.category::text = ANY(p_category_filter))
 *           AND (p_entity_key IS NULL OR m.entity_key = p_entity_key)
 *           AND m.embedding IS NOT NULL
 *         ORDER BY m.embedding <=> p_query_vector
 *         LIMIT p_limit;
 *     ELSE
 *       RETURN QUERY
 *         SELECT m.id, m.entity_key, m.value, m.memory_text, m.certainty::text,
 *                m.importance_score, m.lifecycle_state::text, m.last_confirmed_at, m.valid_until,
 *                m.retrieval_count, m.last_accessed, m.reinforcement_score,
 *                NULL::double precision
 *         FROM memories m
 *         WHERE m.tenant_id = p_tenant_id AND m.user_id = p_user_id
 *           AND m.lifecycle_state::text = ANY(p_lifecycle_filter)
 *           AND (p_category_filter IS NULL OR m.category::text = ANY(p_category_filter))
 *           AND (p_entity_key IS NULL OR m.entity_key = p_entity_key)
 *         ORDER BY m.last_confirmed_at DESC
 *         LIMIT p_limit;
 *     END IF;
 *   END;
 *   $$ LANGUAGE plpgsql STABLE;
 *
 * Until this function exists, both search methods below will fail with
 * Postgres 42883 (undefined_function).
 */

interface SearchMemoriesRow {
  id: string;
  entity_key: string;
  value: string;
  memory_text: string;
  certainty: string;
  importance_score: string;
  lifecycle_state: string;
  last_confirmed_at: string;
  valid_until: string | null;
  retrieval_count: number;
  last_accessed: string | null;
  reinforcement_score: string;
  similarity_score: number | null;
}

function toCandidateMemory(row: SearchMemoriesRow): CandidateMemory {
  return {
    id: row.id,
    entityKey: row.entity_key as CandidateMemory['entityKey'],
    value: row.value,
    memoryText: row.memory_text,
    certainty: row.certainty,
    importanceScore: parseFloat(row.importance_score),
    lifecycleState: row.lifecycle_state as CandidateMemory['lifecycleState'],
    validFrom: row.last_confirmed_at,
    validUntil: row.valid_until,
    retrievalCount: row.retrieval_count,
    lastAccessed: row.last_accessed,
    reinforcementScore: parseFloat(row.reinforcement_score),
    ...(row.similarity_score !== null ? { similarityScore: row.similarity_score } : {}),
  };
}

function unwrap<T>(result: SupabaseResult<T>, context: string): T {
  if (result.error) {
    throw new Error(`Supabase error in ${context}: ${result.error.message} (${result.error.code ?? 'no code'})`);
  }
  if (result.data === null) {
    throw new Error(`Supabase returned null data with no error in ${context}`);
  }
  return result.data;
}

export interface SupabaseAdapterConfig {
  client: SupabaseClientLike;
}

export class SupabaseAdapter implements DatabaseAdapter {
  private readonly client: SupabaseClientLike;

  constructor(config: SupabaseAdapterConfig) {
    this.client = config.client;
  }

  async rpc<T>(functionName: string, params: Record<string, unknown>): Promise<T> {
    const result = await this.client.rpc<T>(functionName, params);
    return unwrap(result, `rpc(${functionName})`);
  }

  async vectorSearch(params: VectorSearchParams): Promise<CandidateMemory[]> {
    const rows = await this.rpc<SearchMemoriesRow[]>('search_memories', {
      p_tenant_id: params.tenantId,
      p_user_id: params.userId,
      p_lifecycle_filter: params.lifecycleFilter,
      p_limit: params.limit,
      p_query_vector: params.queryVector,
      p_category_filter: params.categoryFilter ?? null,
      p_entity_key: null,
    });
    return rows.map(toCandidateMemory);
  }

  async metadataSearch(params: MetadataSearchParams): Promise<CandidateMemory[]> {
    const rows = await this.rpc<SearchMemoriesRow[]>('search_memories', {
      p_tenant_id: params.tenantId,
      p_user_id: params.userId,
      p_lifecycle_filter: params.lifecycleFilter,
      p_limit: params.limit,
      p_query_vector: null,
      p_category_filter: params.categoryFilter ?? null,
      p_entity_key: params.entityKey ?? null,
    });
    return rows.map(toCandidateMemory);
  }

  async updateReinforcement(memoryIds: string[]): Promise<void> {
    if (memoryIds.length === 0) return;
    // Ch 06.4 — backed by the `reinforce_batch` function (migration 007).
    await this.rpc<null>('reinforce_batch', { p_memory_ids: memoryIds });
  }

  async select<T>(params: {
    table: string;
    filters: Record<string, unknown>;
    orderBy?: { column: string; ascending?: boolean };
    limit?: number;
  }): Promise<T[]> {
    let query = this.client.from<T>(params.table).select('*');
    for (const [column, value] of Object.entries(params.filters)) {
      query = query.eq(column, value);
    }
    if (params.orderBy) {
      query = query.order(params.orderBy.column, { ascending: params.orderBy.ascending ?? true });
    }
    if (params.limit !== undefined) {
      query = query.limit(params.limit);
    }
    const result = await query;
    return unwrap(result, `select(${params.table})`);
  }

  async insert<T>(params: { table: string; values: Record<string, unknown> }): Promise<T> {
    const result = await this.client.from<T>(params.table).insert(params.values).select().single();
    return unwrap(result, `insert(${params.table})`);
  }

  async update<T>(params: {
    table: string;
    filters: Record<string, unknown>;
    values: Record<string, unknown>;
  }): Promise<T[]> {
    let query = this.client.from<T>(params.table).update(params.values);
    for (const [column, value] of Object.entries(params.filters)) {
      query = query.eq(column, value);
    }
    const result = await query.select();
    return unwrap(result, `update(${params.table})`);
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.client.from('entity_key_registry').select('entity_key').limit(1);
      return !result.error;
    } catch {
      return false;
    }
  }
}
