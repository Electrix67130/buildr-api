import { z } from 'zod';
import { CHANTIER_ROLES, type ChantierRole, type RolePermissions } from '@/lib/role-permissions';

export const roleParamsSchema = z.object({
  role: z.enum(CHANTIER_ROLES),
});

/** Les six droits d'un role, tous requis : on enregistre un reglage complet. */
export const updateRolePermissionsSchema = z.object({
  can_view_comments: z.boolean(),
  can_view_photos: z.boolean(),
  can_view_documents: z.boolean(),
  can_view_steps: z.boolean(),
  can_view_team: z.boolean(),
  can_edit: z.boolean(),
});

export type UpdateRolePermissions = z.infer<typeof updateRolePermissionsSchema>;

export type RolePermissionsView = RolePermissions & {
  role: ChantierRole;
  /** Vrai si l'organisation a regle ce role ; faux, ce sont les valeurs d'origine. */
  customized: boolean;
  /** Membres de ce role sur les chantiers de l'organisation : ceux qu'un changement touchera. */
  member_count: number;
};
