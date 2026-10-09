import { Knex } from 'knex';

/**
 * Droits de depart d'un membre de chantier, selon son role.
 *
 * Chaque organisation peut regler les siens (`organization_role_permission`) ;
 * sans reglage, ce sont les valeurs ci-dessous. Ils s'appliquent quand on ajoute
 * quelqu'un a un chantier ou qu'on change son role ; on ajuste ensuite au cas
 * par cas.
 */

export const CHANTIER_ROLES = ['manager', 'ouvrier', 'client', 'gestionnaire_reseau'] as const;
export type ChantierRole = (typeof CHANTIER_ROLES)[number];

export const PERMISSION_FLAGS = [
  'can_view_comments',
  'can_view_photos',
  'can_view_documents',
  'can_view_steps',
  'can_view_team',
  'can_edit',
] as const;
export type PermissionFlag = (typeof PERMISSION_FLAGS)[number];
export type RolePermissions = Record<PermissionFlag, boolean>;

/**
 * Les valeurs de depart quand l'organisation n'a rien regle.
 *
 * `can_edit` est refuse a tous : c'est ce qui s'appliquait a l'ajout d'un
 * membre, et ouvrir le droit de modifier se decide, par role dans les reglages
 * de l'organisation ou par personne sur le chantier.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<ChantierRole, RolePermissions> = {
  manager: {
    can_view_comments: true,
    can_view_photos: true,
    can_view_documents: true,
    can_view_steps: true,
    can_view_team: true,
    can_edit: false,
  },
  ouvrier: {
    can_view_comments: true,
    can_view_photos: true,
    can_view_documents: true,
    can_view_steps: true,
    can_view_team: true,
    can_edit: false,
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
  gestionnaire_reseau: {
    can_view_comments: false,
    can_view_photos: false,
    can_view_documents: true,
    can_view_steps: false,
    can_view_team: false,
    can_edit: false,
  },
};

export function pickFlags(row: Partial<Record<PermissionFlag, unknown>>): RolePermissions {
  return Object.fromEntries(PERMISSION_FLAGS.map((f) => [f, !!row[f]])) as RolePermissions;
}

/** Les droits de depart d'un role dans cette organisation. */
export async function rolePermissionsFor(db: Knex, organizationId: string, role: ChantierRole): Promise<RolePermissions> {
  const row = await db('organization_role_permission')
    .where({ organization_id: organizationId, role })
    .select(...PERMISSION_FLAGS)
    .first();
  return row ? pickFlags(row) : DEFAULT_ROLE_PERMISSIONS[role];
}
