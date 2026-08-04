import type { DatabaseAdapter } from '@adaprio/shared-types';

/**
 * Backs the `feedback` table proposed in migration 013 — see that file's
 * header comment for why no repository/table for this existed before now.
 */
export interface FeedbackRow {
  id: string;
  tenant_id: string;
  user_id: string;
  request_id: string;
  memory_id: string;
  feedback: 'relevant' | 'irrelevant' | 'outdated' | 'incorrect';
  note: string | null;
  created_at: string;
}

export class FeedbackRepository {
  constructor(private readonly db: DatabaseAdapter) {}

  async create(params: {
    tenantId: string;
    userId: string;
    requestId: string;
    memoryId: string;
    feedback: FeedbackRow['feedback'];
    note?: string;
  }): Promise<FeedbackRow> {
    return this.db.insert<FeedbackRow>({
      table: 'feedback',
      values: {
        tenant_id: params.tenantId,
        user_id: params.userId,
        request_id: params.requestId,
        memory_id: params.memoryId,
        feedback: params.feedback,
        note: params.note ?? null,
      },
    });
  }
}
