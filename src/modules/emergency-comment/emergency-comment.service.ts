import { Knex } from 'knex';
import BaseService, { PaginationOptions, PaginatedResult } from '@/lib/base-service';
import { blockedIdsFor } from '@/lib/blocks';
import { EmergencyCommentRow } from './emergency-comment.schema';

export type EmergencyCommentWithAuthor = EmergencyCommentRow & {
  first_name: string;
  last_name: string;
  role: string;
};

class EmergencyCommentService extends BaseService<EmergencyCommentRow> {
  constructor(db: Knex) {
    super(db, 'emergency_comment');
  }

  async findByEmergency(
    emergencyId: string,
    options: PaginationOptions = {},
    viewerId?: string,
  ): Promise<PaginatedResult<EmergencyCommentWithAuthor>> {
    const { page = 1, limit = 50, orderBy = 'created_at', order = 'asc' } = options;
    const offset = (page - 1) * limit;

    const blocked = await blockedIdsFor(this.db, viewerId);
    const baseQuery = this.db(this.table)
      .join('user', 'emergency_comment.author_id', 'user.id')
      .where('emergency_comment.emergency_id', emergencyId)
      .modify((qb) => {
        if (blocked.length > 0) qb.whereNotIn('emergency_comment.author_id', blocked);
      });

    const [items, [{ count }]] = await Promise.all([
      baseQuery
        .clone()
        .select('emergency_comment.*', 'user.first_name', 'user.last_name', 'user.role')
        .orderBy(`emergency_comment.${orderBy}`, order)
        .limit(limit)
        .offset(offset),
      baseQuery.clone().count('* as count') as Promise<{ count: string }[]>,
    ]);

    return {
      data: items,
      meta: { total: parseInt(count, 10), page, limit, totalPages: Math.ceil(parseInt(count, 10) / limit) },
    };
  }
}

export default EmergencyCommentService;
