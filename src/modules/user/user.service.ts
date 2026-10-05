import { Knex } from 'knex';
import bcrypt from 'bcrypt';
import BaseService, { PaginationOptions, PaginatedResult } from '@/lib/base-service';
import { invalidateSessionCache } from '@/lib/session-cache';
import { closeUserConnections } from '@/lib/realtime-hub';
import { UserRow } from './user.schema';
import { normalizePhone, resolveOrganizationCountry } from '@/lib/phone';

const USER_PUBLIC_COLS = [
  'user.id',
  'user.email',
  'user.first_name',
  'user.last_name',
  'user.phone',
  'user.avatar_url',
  'user.company_name',
  'user.is_active',
  'user.created_at',
  'user.updated_at',
];

class UserService extends BaseService<UserRow> {
  constructor(db: Knex) {
    super(db, 'user');
  }

  /**
   * Toute ecriture de `phone` repart d'ici en E.164 (voir `lib/phone.ts`).
   *
   * Le pays de reference est celui de l'organisation : un `06...` saisi par un
   * compte francais devient `+336...`, le meme numero tape depuis une
   * organisation belge serait lu en `+32`. C'est pour cela que la
   * normalisation vit dans le service et non dans le schema Zod, qui ne
   * connait pas l'organisation.
   */
  async create(data: Partial<UserRow>): Promise<UserRow> {
    const orgId = (data as { active_organization_id?: string | null }).active_organization_id ?? data.organization_id;
    return super.create(await this.withNormalizedPhone(data, orgId));
  }

  async update(id: string, data: Partial<UserRow>): Promise<UserRow | undefined> {
    if (!('phone' in data)) return super.update(id, data);
    const user = (await this.db('user')
      .where({ id })
      .select('active_organization_id', 'organization_id')
      .first()) as { active_organization_id?: string | null; organization_id?: string | null } | undefined;
    return super.update(id, await this.withNormalizedPhone(data, user?.active_organization_id ?? user?.organization_id));
  }

  private async withNormalizedPhone(
    data: Partial<UserRow>,
    organizationId: string | null | undefined,
  ): Promise<Partial<UserRow>> {
    if (!('phone' in data)) return data;
    const country = await resolveOrganizationCountry(this.db, organizationId);
    return { ...data, phone: normalizePhone(data.phone, country) };
  }

  /**
   * Recherche insensible a la casse : l'index unique porte sur `lower(email)`
   * et les ecritures sont normalisees, mais une adresse peut encore arriver
   * telle que tapee par un appelant qui ne passe pas par les schemas.
   */
  async findByEmail(email: string): Promise<UserRow | undefined> {
    return (await this.db(this.table)
      .whereRaw('lower(email) = lower(?)', [email])
      .first()) as UserRow | undefined;
  }

  /**
   * Liste les users qui ont une membership dans l'organisation donnee.
   * Le `role` retourne est celui de la membership dans cette org (pas le legacy user.role).
   * `organization_id` retourne l'org filtrante (pour compat avec l'ancien shape).
   */
  async findByOrganization(
    organizationId: string,
    options: PaginationOptions = {},
  ): Promise<PaginatedResult<Omit<UserRow, 'password_hash'>>> {
    const { page = 1, limit = 50, orderBy = 'created_at', order = 'desc' } = options;

    const baseQuery = this.db('user')
      .innerJoin('organization_member', 'organization_member.user_id', 'user.id')
      .where('organization_member.organization_id', organizationId);

    const [{ count }] = (await baseQuery.clone().count('* as count')) as { count: string }[];

    const data = await baseQuery
      .clone()
      .select(
        ...USER_PUBLIC_COLS,
        'organization_member.role as role',
        'organization_member.organization_id as organization_id',
      )
      .orderBy(`user.${orderBy}`, order)
      .limit(limit)
      .offset((page - 1) * limit);

    return {
      data,
      meta: { total: parseInt(count, 10), page, limit, totalPages: Math.ceil(parseInt(count, 10) / limit) },
    };
  }

  async search({
    query,
    organizationId,
    page = 1,
    limit = 20,
  }: {
    query: string;
    organizationId: string;
    page?: number;
    limit?: number;
  }): Promise<PaginatedResult<Omit<UserRow, 'password_hash'>>> {
    const baseQuery = this.db('user')
      .innerJoin('organization_member', 'organization_member.user_id', 'user.id')
      .where('organization_member.organization_id', organizationId)
      .where(function () {
        this.whereILike('user.first_name', `%${query}%`)
          .orWhereILike('user.last_name', `%${query}%`)
          .orWhereILike('user.email', `%${query}%`)
          .orWhereILike('user.company_name', `%${query}%`);
      })
      .where('user.is_active', true);

    const [{ count }] = (await baseQuery.clone().count('* as count')) as { count: string }[];

    const data = await baseQuery
      .clone()
      .select(
        ...USER_PUBLIC_COLS,
        'organization_member.role as role',
        'organization_member.organization_id as organization_id',
      )
      .orderBy('user.last_name', 'asc')
      .limit(limit)
      .offset((page - 1) * limit);

    return {
      data,
      meta: { total: parseInt(count, 10), page, limit, totalPages: Math.ceil(parseInt(count, 10) / limit) },
    };
  }

  /**
   * Return only users who share at least one chantier with the given user.
   * Used for employee/client visibility scoping.
   */
  async findCoMembers(
    userId: string,
    organizationId: string,
    options: PaginationOptions = {},
  ): Promise<PaginatedResult<Omit<UserRow, 'password_hash'>>> {
    const { page = 1, limit = 50, orderBy = 'created_at', order = 'desc' } = options;

    const baseQuery = this.db('user')
      .innerJoin('organization_member', 'organization_member.user_id', 'user.id')
      .where('organization_member.organization_id', organizationId)
      .whereExists(function () {
        this.select('*')
          .from('chantier_member as cm1')
          .join('chantier_member as cm2', 'cm1.chantier_id', 'cm2.chantier_id')
          .whereRaw('cm2.user_id = "user".id')
          .where('cm1.user_id', userId)
          .whereRaw('cm2.user_id != cm1.user_id');
      });

    const [{ count }] = (await baseQuery.clone().count('* as count')) as { count: string }[];

    const data = await baseQuery
      .clone()
      .select(
        ...USER_PUBLIC_COLS,
        'organization_member.role as role',
        'organization_member.organization_id as organization_id',
      )
      .orderBy(`user.${orderBy}`, order)
      .limit(limit)
      .offset((page - 1) * limit);

    return {
      data,
      meta: { total: parseInt(count, 10), page, limit, totalPages: Math.ceil(parseInt(count, 10) / limit) },
    };
  }

  /**
   * Return users in the manager's team (from team_member table).
   */
  async findTeamMembers(
    managerId: string,
    organizationId: string,
    options: PaginationOptions = {},
  ): Promise<PaginatedResult<Omit<UserRow, 'password_hash'>>> {
    const { page = 1, limit = 50, orderBy = 'created_at', order = 'desc' } = options;

    const baseQuery = this.db('user')
      .innerJoin('organization_member', 'organization_member.user_id', 'user.id')
      .where('organization_member.organization_id', organizationId)
      .whereExists(function () {
        this.select('*')
          .from('team_member')
          .whereRaw('team_member.user_id = "user".id')
          .where('team_member.manager_id', managerId);
      });

    const [{ count }] = (await baseQuery.clone().count('* as count')) as { count: string }[];

    const data = await baseQuery
      .clone()
      .select(
        ...USER_PUBLIC_COLS,
        'organization_member.role as role',
        'organization_member.organization_id as organization_id',
      )
      .orderBy(`user.${orderBy}`, order)
      .limit(limit)
      .offset((page - 1) * limit);

    return {
      data,
      meta: { total: parseInt(count, 10), page, limit, totalPages: Math.ceil(parseInt(count, 10) / limit) },
    };
  }

  /**
   * Renvoie l'organisation que l'utilisateur laisserait sans aucun admin s'il partait,
   * alors qu'elle compte encore d'autres membres. `undefined` si aucun risque.
   */
  async findOrgLeftWithoutAdmin(userId: string): Promise<{ name: string } | undefined> {
    const adminOrgs = (await this.db('organization_member')
      .where({ user_id: userId, role: 'admin' })
      .select('organization_id')) as { organization_id: string }[];

    for (const { organization_id } of adminOrgs) {
      const [{ count: otherAdmins }] = (await this.db('organization_member')
        .where({ organization_id, role: 'admin' })
        .whereNot('user_id', userId)
        .count('* as count')) as { count: string }[];
      if (parseInt(otherAdmins, 10) > 0) continue;

      // Dernier admin, mais l'org est vide par ailleurs : on le laisse partir.
      const [{ count: otherMembers }] = (await this.db('organization_member')
        .where({ organization_id })
        .whereNot('user_id', userId)
        .count('* as count')) as { count: string }[];
      if (parseInt(otherMembers, 10) === 0) continue;

      return this.db('organization').where({ id: organization_id }).select('name').first();
    }

    return undefined;
  }

  /**
   * Supprime le compte de l'utilisateur lui-meme (exigence Apple, guideline 5.1.1(v)).
   *
   * Plusieurs FK vers `user` sont en RESTRICT (chantier.created_by, invitation.invited_by,
   * organization.created_by) : un DELETE physique echouerait des que l'utilisateur a cree
   * un chantier. On anonymise donc la ligne — les donnees personnelles sont effacees et le
   * compte devient inutilisable, tandis que l'historique metier de l'organisation survit.
   */
  async deleteOwnAccount(userId: string, password: string): Promise<void> {
    const user = await this.findById(userId);
    if (!user || user.deleted_at) {
      throw Object.assign(new Error('User not found'), { statusCode: 404 });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      throw Object.assign(new Error('Mot de passe incorrect'), { statusCode: 401 });
    }

    const orphanedOrg = await this.findOrgLeftWithoutAdmin(userId);
    if (orphanedOrg) {
      throw Object.assign(
        new Error(
          `Vous êtes le seul administrateur de « ${orphanedOrg.name} ». Nommez un autre administrateur avant de supprimer votre compte.`,
        ),
        { statusCode: 409 },
      );
    }

    await this.anonymizeAccount(userId);
  }

  /**
   * Anonymise un compte : c'est LA suppression, quel que soit le chemin —
   * par soi-meme, par un administrateur, par la console. La ligne reste pour
   * que les messages, photos et chantiers crees survivent sous « Compte
   * supprime » ; une suppression physique les emporterait en cascade, ou
   * echouerait sur les cles en RESTRICT.
   */
  async anonymizeAccount(userId: string): Promise<void> {
    await this.db.transaction(async (trx) => {
      // Revoque les acces et supprime les donnees personnelles rattachees.
      await trx('refresh_token').where({ user_id: userId }).del();
      await trx('push_token').where({ user_id: userId }).del();
      await trx('calendar_integration').where({ user_id: userId }).del();
      await trx('organization_member').where({ user_id: userId }).del();
      await trx('chantier_member').where({ user_id: userId }).del();
      await trx('chantier_template_member').where({ user_id: userId }).del();
      await trx('team_member').where({ user_id: userId }).orWhere({ manager_id: userId }).del();

      await trx('user')
        .where({ id: userId })
        .update({
          // Email neutralise mais toujours unique, pour respecter la contrainte.
          email: `deleted-${userId}@deleted.invalid`,
          first_name: 'Compte',
          last_name: 'supprime',
          phone: null,
          avatar_url: null,
          company_name: null,
          // Hash volontairement invalide : aucun mot de passe ne peut le satisfaire.
          password_hash: '!',
          is_active: false,
          current_mobile_session_id: null,
          current_web_session_id: null,
          active_organization_id: null,
          deleted_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        });
    });

    // Invalide sans attendre les access tokens encore en circulation (cache TTL 30s),
    // et ferme les autres appareils : le dashboard reste ouvert pendant qu'on
    // supprime son compte depuis le telephone, il doit l'apprendre tout de suite.
    invalidateSessionCache(userId);
    closeUserConnections(userId, 'account-deleted');
  }
}

export default UserService;
