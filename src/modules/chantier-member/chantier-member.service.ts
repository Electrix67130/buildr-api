import { Knex } from 'knex';
import BaseService, { PaginationOptions, PaginatedResult } from '@/lib/base-service';
import { ChantierMemberRow } from './chantier-member.schema';

type Role = 'manager' | 'ouvrier' | 'client' | 'gestionnaire_reseau';

/** Default permissions per role */
export const DEFAULT_PERMISSIONS: Record<
  Role,
  Pick<
    ChantierMemberRow,
    | 'can_view_comments'
    | 'can_view_photos'
    | 'can_view_documents'
    | 'can_view_steps'
    | 'can_view_team'
    | 'can_edit'
  >
> = {
  manager: {
    can_view_comments: true,
    can_view_photos: true,
    can_view_documents: true,
    can_view_steps: true,
    can_view_team: true,
    can_edit: true,
  },
  ouvrier: {
    can_view_comments: true,
    can_view_photos: true,
    can_view_documents: true,
    can_view_steps: true,
    can_view_team: true,
    can_edit: true,
  },
  client: {
    can_view_comments: true,
    can_view_photos: true,
    can_view_documents: false,
    can_view_steps: false,
    can_view_team: true,
    can_edit: false,
  },
  // Gestionnaire reseau : acces minimal — uniquement les DICT (filtre serveur).
  // Pas de Equipe (perm desactivee). Le reste est configurable comme un client.
  gestionnaire_reseau: {
    can_view_comments: false,
    can_view_photos: false,
    can_view_documents: true,
    can_view_steps: false,
    can_view_team: false,
    can_edit: false,
  },
};

class ChantierMemberService extends BaseService<ChantierMemberRow> {
  constructor(db: Knex) {
    super(db, 'chantier_member');
  }

  /** Override create to apply role-based default permissions */
  async create(data: Partial<ChantierMemberRow>): Promise<ChantierMemberRow> {
    const role = (data.role as Role) || 'ouvrier';
    const defaults = DEFAULT_PERMISSIONS[role];
    return super.create({ ...defaults, ...data });
  }

  /** When changing role, reset permissions to role defaults unless explicitly overridden */
  async changeRole(id: string, role: Role, overrides: Partial<ChantierMemberRow> = {}): Promise<ChantierMemberRow | undefined> {
    const defaults = DEFAULT_PERMISSIONS[role];
    return this.update(id, { role, ...defaults, ...overrides });
  }

  /** List members of a chantier with user info */
  async findByChantier(
    chantierId: string,
    options: PaginationOptions = {},
  ): Promise<PaginatedResult<ChantierMemberRow & { first_name: string; last_name: string; email: string; company_name?: string; user_role: string }>> {
    const { page = 1, limit = 50, orderBy = 'created_at', order = 'asc' } = options;
    const offset = (page - 1) * limit;

    const baseQuery = this.db(this.table)
      .join('user', 'chantier_member.user_id', 'user.id')
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
          this.db.raw('"user"."role" as user_role'),
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
