import type { DatabaseAdapter, EntityKey } from '@adaprio/shared-types';
import type { MemoryEventRow } from '../types/db.js';

/**
 * `memory_events` (migration 004) has no governance RPC function — it is
 * populated entirely by the `trg_log_memory_event` trigger (migration
 * 006), never written to directly by application code. This repository is
 * read-only. Per Ch 9.9, a plain filtered read has "no atomicity
 * requirement," so these use the generic `select()` primitive rather than
 * a named Postgres function.
 */
export class EventRepository {
  constructor(private readonly db: DatabaseAdapter) {}

  /** Full audit history for one memory, oldest first — powers the dashboard version-history view (Ch 13). */
  async getHistory(params: { tenantId: string; userId: string; memoryId: string }): Promise<MemoryEventRow[]> {
    return this.db.select<MemoryEventRow>({
      table: 'memory_events',
      filters: {
        tenant_id: params.tenantId,
        user_id: params.userId,
        memory_id: params.memoryId,
      },
      orderBy: { column: 'created_at', ascending: true },
    });
  }

  /** Most recent events across ALL versions of an entity_key, newest first — e.g. "everything that ever happened to employment.organization." */
  async listByEntityKey(params: {
    tenantId: string;
    userId: string;
    entityKey: EntityKey;
    limit?: number;
  }): Promise<MemoryEventRow[]> {
    return this.db.select<MemoryEventRow>({
      table: 'memory_events',
      filters: {
        tenant_id: params.tenantId,
        user_id: params.userId,
        entity_key: params.entityKey,
      },
      orderBy: { column: 'created_at', ascending: false },
      limit: params.limit ?? 50,
    });
  }
}
