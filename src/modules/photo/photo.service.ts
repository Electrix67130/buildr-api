import { Knex } from 'knex';
import BaseService, { PaginationOptions, PaginatedResult } from '@/lib/base-service';
import { blockedIdsFor } from '@/lib/blocks';
import { PhotoRow } from './photo.schema';

class PhotoService extends BaseService<PhotoRow> {
  constructor(db: Knex) {
    super(db, 'photo');
  }

  async findByChantier(
    chantierId: string,
    options: PaginationOptions = {},
    stepId?: string,
    viewerId?: string,
  ): Promise<PaginatedResult<PhotoRow & { first_name: string; last_name: string }>> {
    const { page = 1, limit = 20, orderBy = 'created_at', order = 'desc' } = options;
    const offset = (page - 1) * limit;

    const blocked = await blockedIdsFor(this.db, viewerId);
    const baseQuery = this.db(this.table)
      .join('user', 'photo.uploaded_by', 'user.id')
      .where('photo.chantier_id', chantierId)
      .modify((qb) => {
        if (blocked.length > 0) qb.whereNotIn('photo.uploaded_by', blocked);
      })
      // Les photos d'une urgence se voient sur l'urgence, pas dans la galerie :
      // elles documentent un incident, pas l'avancement du chantier.
      .whereNull('photo.emergency_id')
      .modify((qb) => {
        if (stepId) qb.where('photo.step_id', stepId);
      });

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
