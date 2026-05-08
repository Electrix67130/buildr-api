import { Knex } from 'knex';

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
  // Admin bypass — base sur la membership active du user
  const activeMember = await db('user')
    .leftJoin('organization_member', function () {
      this.on('organization_member.user_id', '=', 'user.id').andOn(
        'organization_member.organization_id',
        '=',
        'user.active_organization_id',
      );
    })
    .where('user.id', userId)
    .select('organization_member.role as role')
    .first();
  if (activeMember?.role === 'admin') return true;

  // Chantier creator bypass
  const chantier = await db('chantier').where({ id: chantierId }).select('created_by').first();
  if (!chantier) return false;
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
