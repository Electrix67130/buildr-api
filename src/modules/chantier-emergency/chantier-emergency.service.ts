import { Knex } from 'knex';
import BaseService, { PaginationOptions, PaginatedResult } from '@/lib/base-service';
import { EmergencyRow } from './chantier-emergency.schema';

class ChantierEmergencyService extends BaseService<EmergencyRow> {
  constructor(db: Knex) {
    super(db, 'chantier_emergency');
  }

  async findByChantier(
    chantierId: string,
    options: PaginationOptions = {},
  ): Promise<PaginatedResult<EmergencyRow & { first_name: string; last_name: string; type: 'emergency' | 'claim' }>> {
    const { page = 1, limit = 20, orderBy = 'created_at', order = 'desc' } = options;
    const offset = (page - 1) * limit;

    const baseQuery = this.db(this.table)
      .join('user', 'chantier_emergency.created_by', 'user.id')
      .leftJoin('chantier_member', function () {
        this.on('chantier_member.user_id', '=', 'chantier_emergency.created_by').andOn(
          'chantier_member.chantier_id',
          '=',
          'chantier_emergency.chantier_id',
        );
      })
      .where('chantier_emergency.chantier_id', chantierId);

    const [rows, [{ count }]] = await Promise.all([
      baseQuery
        .clone()
        .select(
          'chantier_emergency.*',
          'user.first_name',
          'user.last_name',
          'chantier_member.role as member_role',
        )
        .orderBy(`chantier_emergency.${orderBy}`, order)
        .limit(limit)
        .offset(offset),
      baseQuery.clone().count('* as count') as Promise<{ count: string }[]>,
    ]);

    // Mapping : auteur membre client -> reclamation, sinon urgence (admin/createur/manager/ouvrier).
    const items = (rows as Array<EmergencyRow & { first_name: string; last_name: string; member_role: string | null }>).map(
      ({ member_role, ...rest }) => ({
        ...rest,
        type: (member_role === 'client' ? 'claim' : 'emergency') as 'emergency' | 'claim',
      }),
    );

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
}

export default ChantierEmergencyService;
