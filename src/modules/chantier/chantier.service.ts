import { Knex } from 'knex';
import BaseService, { PaginationOptions, PaginatedResult } from '@/lib/base-service';
import { ChantierRow, SearchChantier } from './chantier.schema';

class ChantierService extends BaseService<ChantierRow> {
  constructor(db: Knex) {
    super(db, 'chantier');
  }

  /** List active (non-archived) chantiers, optionally filtered by status */
  async findActive(
    organizationId: string,
    options: PaginationOptions & { status?: string; userId?: string; restrictToMember?: boolean } = {},
  ): Promise<PaginatedResult<ChantierRow>> {
    const { page = 1, limit = 20, orderBy = 'created_at', order = 'desc', status, userId, restrictToMember } = options;
    const offset = (page - 1) * limit;

    const baseQuery = this.db(this.table)
      .where('chantier.organization_id', organizationId)
      .whereNull('archived_at');

    // Non-admin users only see chantiers they're a member of OR created
    if (restrictToMember && userId) {
      baseQuery.where((qb) => {
        qb.where('chantier.created_by', userId).orWhereExists(function () {
          this.select('*')
            .from('chantier_member')
            .whereRaw('chantier_member.chantier_id = chantier.id')
            .where('chantier_member.user_id', userId);
        });
      });
    }

    if (status) {
      baseQuery.where('status', status);
    }

    const [items, [{ count }]] = await Promise.all([
      baseQuery
        .clone()
        .select('*')
        .orderBy(orderBy, order)
        .limit(limit)
        .offset(offset) as Promise<ChantierRow[]>,
      baseQuery.clone().count('* as count') as Promise<{ count: string }[]>,
    ]);

    return {
      data: items,
      meta: {
        total: parseInt(count, 10),
        page,
        limit,
        totalPages: Math.ceil(parseInt(count, 10) / limit),
      },
    };
  }

  /** Search by keyword and/or GPS coordinates (Haversine) */
  async search(
    organizationId: string,
    params: SearchChantier & { userId?: string; restrictToMember?: boolean },
  ): Promise<PaginatedResult<ChantierRow & { distance_km?: number }>> {
    const { q, lat, lng, radius_km = 50, status, page = 1, limit = 20, userId, restrictToMember } = params;
    const offset = (page - 1) * limit;

    const baseQuery = this.db(this.table)
      .where('chantier.organization_id', organizationId)
      .whereNull('archived_at');

    if (restrictToMember && userId) {
      baseQuery.where((qb) => {
        qb.where('chantier.created_by', userId).orWhereExists(function () {
          this.select('*')
            .from('chantier_member')
            .whereRaw('chantier_member.chantier_id = chantier.id')
            .where('chantier_member.user_id', userId);
        });
      });
    }

    if (status) {
      baseQuery.where('status', status);
    }

    if (q) {
      baseQuery.where(function () {
        this.whereILike('name', `%${q}%`)
          .orWhereILike('address', `%${q}%`)
          .orWhereILike('city', `%${q}%`)
          .orWhereILike('postal_code', `%${q}%`)
          .orWhereILike('description', `%${q}%`);
      });
    }

    if (lat !== undefined && lng !== undefined) {
      const haversine = `
        6371 * acos(
          LEAST(1, GREATEST(-1,
            cos(radians(?)) * cos(radians(latitude)) *
            cos(radians(longitude) - radians(?)) +
            sin(radians(?)) * sin(radians(latitude))
          ))
        )
      `;

      baseQuery
        .whereNotNull('latitude')
        .whereNotNull('longitude')
        .whereRaw(`${haversine} <= ?`, [lat, lng, lat, radius_km]);
    }

    const [{ count }] = (await baseQuery.clone().count('* as count')) as { count: string }[];

    let itemsQuery = baseQuery.clone();

    if (lat !== undefined && lng !== undefined) {
      const haversine = `
        6371 * acos(
          LEAST(1, GREATEST(-1,
            cos(radians(?)) * cos(radians(latitude)) *
            cos(radians(longitude) - radians(?)) +
            sin(radians(?)) * sin(radians(latitude))
          ))
        )
      `;
      itemsQuery = itemsQuery
        .select('*', this.db.raw(`${haversine} as distance_km`, [lat, lng, lat]))
        .orderByRaw(`${haversine} ASC`, [lat, lng, lat]);
    } else {
      itemsQuery = itemsQuery.select('*').orderBy('created_at', 'desc');
    }

    const items = (await itemsQuery.limit(limit).offset(offset)) as (ChantierRow & {
      distance_km?: number;
    })[];

    return {
      data: items,
      meta: {
        total: parseInt(count, 10),
        page,
        limit,
        totalPages: Math.ceil(parseInt(count, 10) / limit),
      },
    };
  }

  /** Archive a chantier (set archived_at + auto_delete_at according to org retention) */
  async archive(id: string): Promise<ChantierRow | undefined> {
    const chantier = await this.findById(id);
    if (!chantier) return undefined;

    const org = await this.db('organization')
      .where({ id: chantier.organization_id })
      .select('archive_retention_years')
      .first();
    const retentionYears = org?.archive_retention_years ?? 5;

    const now = new Date();
    const deleteAt = new Date(now);
    deleteAt.setFullYear(deleteAt.getFullYear() + retentionYears);

    const [row] = await this.db(this.table)
      .where({ id })
      .whereNull('archived_at')
      .update({
        archived_at: now,
        auto_delete_at: deleteAt,
        status: 'termine',
        updated_at: this.db.fn.now(),
      })
      .returning('*');

    return row as ChantierRow | undefined;
  }

  /** Unarchive a chantier */
  async unarchive(id: string): Promise<ChantierRow | undefined> {
    const [row] = await this.db(this.table)
      .where({ id })
      .whereNotNull('archived_at')
      .update({
        archived_at: null,
        auto_delete_at: null,
        updated_at: this.db.fn.now(),
      })
      .returning('*');

    return row as ChantierRow | undefined;
  }

  /** Update retention for an already-archived chantier (recompute auto_delete_at = archived_at + years) */
  async setRetention(id: string, years: number): Promise<ChantierRow | undefined> {
    const chantier = await this.findById(id);
    if (!chantier || !chantier.archived_at) return undefined;

    const archivedAt = new Date(chantier.archived_at);
    const deleteAt = new Date(archivedAt);
    deleteAt.setFullYear(deleteAt.getFullYear() + years);

    const [row] = await this.db(this.table)
      .where({ id })
      .whereNotNull('archived_at')
      .update({
        auto_delete_at: deleteAt,
        updated_at: this.db.fn.now(),
      })
      .returning('*');

    return row as ChantierRow | undefined;
  }

  /** List archived chantiers */
  async findArchived(
    organizationId: string,
    options: PaginationOptions & { q?: string; userId?: string; restrictToMember?: boolean } = {},
  ): Promise<PaginatedResult<ChantierRow>> {
    const { page = 1, limit = 20, orderBy = 'archived_at', order = 'desc', q, userId, restrictToMember } = options;
    const offset = (page - 1) * limit;

    const baseQuery = this.db(this.table)
      .where('chantier.organization_id', organizationId)
      .whereNotNull('archived_at');

    if (restrictToMember && userId) {
      baseQuery.where((qb) => {
        qb.where('chantier.created_by', userId).orWhereExists(function () {
          this.select('*')
            .from('chantier_member')
            .whereRaw('chantier_member.chantier_id = chantier.id')
            .where('chantier_member.user_id', userId);
        });
      });
    }

    if (q) {
      baseQuery.where(function () {
        this.whereILike('name', `%${q}%`)
          .orWhereILike('address', `%${q}%`)
          .orWhereILike('city', `%${q}%`);
      });
    }

    const [items, [{ count }]] = await Promise.all([
      baseQuery
        .clone()
        .select('*')
        .orderBy(orderBy, order)
        .limit(limit)
        .offset(offset) as Promise<ChantierRow[]>,
      baseQuery.clone().count('* as count') as Promise<{ count: string }[]>,
    ]);

    return {
      data: items,
      meta: {
        total: parseInt(count, 10),
        page,
        limit,
        totalPages: Math.ceil(parseInt(count, 10) / limit),
      },
    };
  }

  /** Purge expired archives (auto_delete_at < now) */
  async purgeExpiredArchives(): Promise<number> {
    return this.db(this.table)
      .whereNotNull('auto_delete_at')
      .where('auto_delete_at', '<', this.db.fn.now())
      .del();
  }
}

export default ChantierService;
