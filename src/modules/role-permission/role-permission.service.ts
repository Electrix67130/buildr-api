import { Knex } from 'knex';
import {
  CHANTIER_ROLES,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_FLAGS,
  pickFlags,
  type ChantierRole,
  type RolePermissions,
} from '@/lib/role-permissions';
import type { RolePermissionsView } from './role-permission.schema';

class RolePermissionService {
  constructor(private readonly db: Knex) {}

  /** Les quatre roles, avec les droits en vigueur dans l'organisation. */
  async list(organizationId: string): Promise<RolePermissionsView[]> {
    const rows = (await this.db('organization_role_permission')
      .where({ organization_id: organizationId })
      .select('role', ...PERMISSION_FLAGS)) as (RolePermissions & { role: ChantierRole })[];
    const counts = (await this.membersOfOrganization(organizationId)
      .groupBy('chantier_member.role')
      .select('chantier_member.role')
      .count({ count: '*' })) as { role: string; count: string | number }[];

    return CHANTIER_ROLES.map((role) => {
      const row = rows.find((r) => r.role === role);
      return {
        role,
        ...(row ? pickFlags(row) : DEFAULT_ROLE_PERMISSIONS[role]),
        customized: !!row,
        member_count: Number(counts.find((c) => c.role === role)?.count ?? 0),
      };
    });
  }

  /**
   * Regle un role, et l'applique a tous ses membres sur les chantiers de
   * l'organisation : les ajustements faits personne par personne sont
   * remplaces. Renvoie les chantiers touches, pour prevenir leurs clients.
   */
  async set(organizationId: string, role: ChantierRole, permissions: RolePermissions): Promise<{ chantierIds: string[]; updated: number }> {
    return this.db.transaction(async (trx) => {
      await trx('organization_role_permission')
        .insert({ organization_id: organizationId, role, ...permissions })
        .onConflict(['organization_id', 'role'])
        .merge({ ...permissions, updated_at: trx.fn.now() });
      return this.applyToMembers(trx, organizationId, role, permissions);
    });
  }

  /** Revient aux valeurs d'origine, appliquees elles aussi a tous les membres du role. */
  async reset(organizationId: string, role: ChantierRole): Promise<{ chantierIds: string[]; updated: number }> {
    return this.db.transaction(async (trx) => {
      await trx('organization_role_permission').where({ organization_id: organizationId, role }).del();
      return this.applyToMembers(trx, organizationId, role, DEFAULT_ROLE_PERMISSIONS[role]);
    });
  }

  private membersOfOrganization(organizationId: string, db: Knex = this.db) {
    return db('chantier_member')
      .join('chantier', 'chantier.id', 'chantier_member.chantier_id')
      .where('chantier.organization_id', organizationId);
  }

  private async applyToMembers(
    trx: Knex,
    organizationId: string,
    role: ChantierRole,
    permissions: RolePermissions,
  ): Promise<{ chantierIds: string[]; updated: number }> {
    const chantierIds = (await trx('chantier').where({ organization_id: organizationId }).pluck('id')) as string[];
    if (chantierIds.length === 0) return { chantierIds: [], updated: 0 };
    const updated = await trx('chantier_member')
      .whereIn('chantier_id', chantierIds)
      .where({ role })
      .update({ ...permissions, updated_at: trx.fn.now() });
    const touched = (await trx('chantier_member')
      .whereIn('chantier_id', chantierIds)
      .where({ role })
      .distinct('chantier_id')
      .pluck('chantier_id')) as string[];
    return { chantierIds: touched, updated };
  }
}

export default RolePermissionService;
