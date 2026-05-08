import { Knex } from 'knex';
import BaseService, { PaginationOptions, PaginatedResult } from '@/lib/base-service';
import { PhotoCommentRow } from './photo-comment.schema';

class PhotoCommentService extends BaseService<PhotoCommentRow> {
  constructor(db: Knex) {
    super(db, 'photo_comment');
  }

  async findByPhoto(
    photoId: string,
    options: PaginationOptions = {},
  ): Promise<PaginatedResult<PhotoCommentRow & { first_name: string; last_name: string }>> {
    const { page = 1, limit = 20, orderBy = 'created_at', order = 'desc' } = options;
    const offset = (page - 1) * limit;

    const baseQuery = this.db(this.table)
      .join('user', 'photo_comment.author_id', 'user.id')
      .where('photo_comment.photo_id', photoId);

    const [items, [{ count }]] = await Promise.all([
      baseQuery
        .clone()
        .select('photo_comment.*', 'user.first_name', 'user.last_name')
        .orderBy(`photo_comment.${orderBy}`, order)
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

export default PhotoCommentService;
