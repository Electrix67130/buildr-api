import { Knex } from 'knex';
import BaseService, { PaginationOptions, PaginatedResult } from '@/lib/base-service';
import { CommentRow } from './comment.schema';

class CommentService extends BaseService<CommentRow> {
  constructor(db: Knex) {
    super(db, 'comment');
  }

  /** List comments for a chantier with author info, optionally filtered by step_id */
  async findByChantier(
    chantierId: string,
    options: PaginationOptions & { stepId?: string | null | 'general' } = {},
  ): Promise<PaginatedResult<CommentRow & { first_name: string; last_name: string; avatar_url?: string }>> {
    const { page = 1, limit = 20, orderBy = 'created_at', order = 'desc', stepId } = options;
    const offset = (page - 1) * limit;

    const baseQuery = this.db(this.table)
      .join('user', 'comment.author_id', 'user.id')
      .where('comment.chantier_id', chantierId);

    if (stepId === 'general') {
      baseQuery.whereNull('comment.step_id');
    } else if (typeof stepId === 'string') {
      baseQuery.where('comment.step_id', stepId);
    }

    const [items, [{ count }]] = await Promise.all([
      baseQuery
        .clone()
        .select('comment.*', 'user.first_name', 'user.last_name', 'user.avatar_url')
        .orderBy(`comment.${orderBy}`, order)
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

export default CommentService;
