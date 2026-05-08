import { Knex } from 'knex';
import BaseService, { PaginationOptions, PaginatedResult } from '@/lib/base-service';
import { DocumentRow } from './document.schema';

class DocumentService extends BaseService<DocumentRow> {
  constructor(db: Knex) {
    super(db, 'document');
  }

  async findByChantier(
    chantierId: string,
    options: PaginationOptions & { type?: string } = {},
  ): Promise<PaginatedResult<DocumentRow & { first_name: string; last_name: string }>> {
    const { page = 1, limit = 20, orderBy = 'created_at', order = 'desc', type } = options;
    const offset = (page - 1) * limit;

    const baseQuery = this.db(this.table)
      .join('user', 'document.uploaded_by', 'user.id')
      .where('document.chantier_id', chantierId);

    if (type) {
      baseQuery.where('document.type', type);
    }

    const [items, [{ count }]] = await Promise.all([
      baseQuery
        .clone()
        .select('document.*', 'user.first_name', 'user.last_name')
        .orderBy(`document.${orderBy}`, order)
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

export default DocumentService;
