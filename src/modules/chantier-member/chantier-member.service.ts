import { Knex } from 'knex';
import BaseService, { PaginationOptions, PaginatedResult } from '@/lib/base-service';
import { ChantierMemberRow, MentionableUser } from './chantier-member.schema';
import { rolePermissionsFor, type ChantierRole } from '@/lib/role-permissions';

type Role = ChantierRole;

class ChantierMemberService extends BaseService<ChantierMemberRow> {
  constructor(db: Knex) {
    super(db, 'chantier_member');
  }

  /**
   * Ajout d'un membre : les droits de depart de son role dans l'organisation du
   * chantier, sauf ceux precises dans `data`.
   */
  async createWithRoleDefaults(organizationId: string, data: Partial<ChantierMemberRow>): Promise<ChantierMemberRow> {
    const role = (data.role as Role) || 'ouvrier';
    const defaults = await rolePermissionsFor(this.db, organizationId, role);
    return super.create({ ...defaults, ...stripUndefined(data) });
  }

  /** Changement de role : les droits de depart du nouveau role, sauf ceux precises. */
  async changeRole(
    organizationId: string,
    id: string,
    role: Role,
    overrides: Partial<ChantierMemberRow> = {},
  ): Promise<ChantierMemberRow | undefined> {
    const defaults = await rolePermissionsFor(this.db, organizationId, role);
    return this.update(id, { role, ...defaults, ...stripUndefined(overrides) });
  }

  /** List members of a chantier with user info */
  async findByChantier(
    chantierId: string,
    options: PaginationOptions = {},
  ): Promise<PaginatedResult<ChantierMemberRow & { first_name: string; last_name: string; email: string; company_name?: string; user_role: string }>> {
    const { page = 1, limit = 50, orderBy = 'created_at', order = 'asc' } = options;
    const offset = (page - 1) * limit;

    // `user_role` est le role dans l'organisation DU CHANTIER, lu sur
    // organization_member. La colonne `user.role` est un vestige : elle
    // affichait l'ancien role, et un administrateur promu depuis restait
    // modifiable comme un simple ouvrier dans l'equipe du chantier.
    const baseQuery = this.db(this.table)
      .join('user', 'chantier_member.user_id', 'user.id')
      .join('chantier', 'chantier.id', 'chantier_member.chantier_id')
      .leftJoin('organization_member', function () {
        this.on('organization_member.user_id', '=', 'user.id').andOn(
          'organization_member.organization_id',
          '=',
          'chantier.organization_id',
        );
      })
      .where('chantier_member.chantier_id', chantierId);

    const [items, [{ count }]] = await Promise.all([
      baseQuery
        .clone()
        .select(
          'chantier_member.*',
          'user.first_name',
          'user.last_name',
          'user.email',
          'user.phone',
          'user.company_name',
          'organization_member.role as user_role',
        )
        .orderBy(`chantier_member.${orderBy}`, order)
        .limit(limit)
        .offset(offset),
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

  /** List chantiers of a user */
  async findByUser(userId: string): Promise<ChantierMemberRow[]> {
    return this.findMany({ user_id: userId } as Partial<ChantierMemberRow>);
  }

  /** Renvoie la propre ligne du user sur un chantier (avec infos user jointes), null sinon. */
  /** Les comptes actifs parmi `userIds`, avec leur nom seulement, par ordre alphabetique. */
  async findMentionable(userIds: string[]): Promise<MentionableUser[]> {
    if (userIds.length === 0) return [];
    return this.db('user')
      .whereIn('id', userIds)
      .where({ is_active: true })
      .whereNull('deleted_at')
      .orderBy([{ column: 'first_name' }, { column: 'last_name' }])
      .select('id', 'first_name', 'last_name');
  }

  async findOwnWithUser(
    userId: string,
    chantierId: string,
  ): Promise<(ChantierMemberRow & { first_name: string; last_name: string; email: string; phone?: string; company_name?: string; user_role: string }) | null> {
    const row = await this.db(this.table)
      .join('user', 'chantier_member.user_id', 'user.id')
      .where({ 'chantier_member.chantier_id': chantierId, 'chantier_member.user_id': userId })
      .select(
        'chantier_member.*',
        'user.first_name',
        'user.last_name',
        'user.email',
        'user.phone',
        'user.company_name',
        this.db.raw('"user"."role" as user_role'),
      )
      .first();
    return row ?? null;
  }

  /** Check if a user is member of a chantier */
  async isMember(chantierId: string, userId: string): Promise<ChantierMemberRow | undefined> {
    return this.findOne({ chantier_id: chantierId, user_id: userId } as Partial<ChantierMemberRow>);
  }
}

export default ChantierMemberService;

/** Un champ absent ne doit pas ecraser la valeur par defaut du role. */
function stripUndefined<T extends object>(data: T): Partial<T> {
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) as Partial<T>;
}
