import { Knex } from 'knex';
import BaseService, { PaginationOptions, PaginatedResult } from '@/lib/base-service';
import { PhotoRow } from './photo.schema';

class PhotoService extends BaseService<PhotoRow> {
  constructor(db: Knex) {
    super(db, 'photo');
  }

  async findByChantier(
    chantierId: string,
    options: PaginationOptions = {},
  ): Promise<PaginatedResult<PhotoRow & { first_name: string; last_name: string }>> {
    const { page = 1, limit = 20, orderBy = 'created_at', order = 'desc' } = options;
    const offset = (page - 1) * limit;

    const baseQuery = this.db(this.table)
      .join('user', 'photo.uploaded_by', 'user.id')
      .where('photo.chantier_id', chantierId);

    const [items, [{ count }]] = await Promise.all([
      baseQuery
        .clone()
        .select('photo.*', 'user.first_name', 'user.last_name')
        .orderBy(`photo.${orderBy}`, order)
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

export default PhotoService;
