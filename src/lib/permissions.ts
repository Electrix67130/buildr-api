import { Knex } from 'knex';
import { getActiveMembership } from './active-membership';

export type Permission =
  | 'view_comments'
  | 'view_photos'
  | 'view_documents'
  | 'view_steps'
  | 'view_team'
  | 'edit';

const PERMISSION_COLUMN: Record<Permission, string> = {
  view_comments: 'can_view_comments',
  view_photos: 'can_view_photos',
  view_documents: 'can_view_documents',
  view_steps: 'can_view_steps',
  view_team: 'can_view_team',
  edit: 'can_edit',
};

/**
 * Contournements legitimes sur un chantier : l'administrateur de l'organisation
 * DU CHANTIER, et celui qui l'a cree.
 *
 * Cette regle etait reecrite dans chaque module qui en avait besoin — et chaque
 * copie oubliait la meme moitie : verifier que le chantier appartient bien a
 * l'organisation de l'administrateur. Etre admin QUELQUE PART suffisait alors a
 * agir sur les chantiers de n'importe quelle entreprise. Elle vit desormais
 * ici, et nulle part ailleurs.
 */
export async function isChantierAdminOrCreator(
  db: Knex,
  userId: string,
  chantierId: string,
): Promise<boolean> {
  const chantier = await db('chantier')
    .where({ id: chantierId })
    .select('created_by', 'organization_id')
    .first();
  if (!chantier) return false;
  if (chantier.created_by === userId) return true;

  const membership = await getActiveMembership(db, userId);
  return membership?.role === 'admin' && membership.organization_id === chantier.organization_id;
}

/**
 * Participe-t-il a ce chantier ? Membre, createur, ou administrateur de
 * l'organisation a laquelle le chantier appartient.
 *
 * Sert aux ressources qui n'ont pas de drapeau de permission dedie — le fil de
 * discussion d'une urgence, par exemple : y ecrire suppose d'etre sur le
 * chantier, pas seulement d'avoir un compte.
 */
export async function isChantierParticipant(
  db: Knex,
  userId: string,
  chantierId: string,
): Promise<boolean> {
  if (await isChantierAdminOrCreator(db, userId, chantierId)) return true;
  const member = await db('chantier_member').where({ chantier_id: chantierId, user_id: userId }).first();
  return !!member;
}

/**
 * Check if a user has a specific permission on a chantier.
 * Admins (user.role = 'admin') always pass.
 * The chantier creator (created_by) always passes.
 * Otherwise, checks chantier_member flags.
 */
export async function hasPermission(
  db: Knex,
  userId: string,
  chantierId: string,
  permission: Permission,
): Promise<boolean> {
  const chantier = await db('chantier')
    .where({ id: chantierId })
    .select('created_by', 'organization_id')
    .first();
  if (!chantier) return false;

  // Admin bypass — base sur la membership active du user, ET limite a son
  // organisation. Sans cette seconde condition, etre administrateur QUELQUE
  // PART suffisait : un admin de l'organisation A passait tous les controles
  // sur les chantiers de l'organisation B — documents, photos, discussions, et
  // jusqu'au droit d'y ecrire.
  const activeMember = await db('user')
    .leftJoin('organization_member', function () {
      this.on('organization_member.user_id', '=', 'user.id').andOn(
        'organization_member.organization_id',
        '=',
        'user.active_organization_id',
      );
    })
    .where('user.id', userId)
    .select('organization_member.role as role', 'user.active_organization_id as organization_id')
    .first();
  if (activeMember?.role === 'admin' && activeMember.organization_id === chantier.organization_id) {
    return true;
  }

  // Chantier creator bypass
  if (chantier.created_by === userId) return true;

  // Check member permissions
  const member = await db('chantier_member')
    .where({ chantier_id: chantierId, user_id: userId })
    .select(PERMISSION_COLUMN[permission])
    .first();

  return !!member?.[PERMISSION_COLUMN[permission]];
}

/**
 * Require a permission — throw a 403 error if denied.
 * Used in route handlers.
 */
export async function requirePermission(
  db: Knex,
  userId: string,
  chantierId: string,
  permission: Permission,
): Promise<void> {
  const ok = await hasPermission(db, userId, chantierId, permission);
  if (!ok) {
    throw Object.assign(new Error('Forbidden: insufficient permissions'), { statusCode: 403 });
  }
}

/** Get all permissions a user has on a chantier */
export async function getUserPermissions(
  db: Knex,
  userId: string,
  chantierId: string,
): Promise<Record<Permission, boolean>> {
  const perms: Permission[] = [
    'view_comments',
    'view_photos',
    'view_documents',
    'view_steps',
    'view_team',
    'edit',
  ];
  const result = {} as Record<Permission, boolean>;
  for (const p of perms) {
    result[p] = await hasPermission(db, userId, chantierId, p);
  }
  return result;
}
