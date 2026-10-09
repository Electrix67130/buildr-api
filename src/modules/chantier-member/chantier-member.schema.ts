import { z } from 'zod';

export const createChantierMemberSchema = z.object({
  chantier_id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: z.enum(['manager', 'ouvrier', 'client', 'gestionnaire_reseau']).optional().default('ouvrier'),
  // Droits de lecture absents : ceux du role s'appliquent (DEFAULT_PERMISSIONS).
  // Ils valaient tous `true` ici, ce qui ecrasait les valeurs du role : un
  // gestionnaire reseau ajoute sans droits precises voyait les discussions,
  // les photos et les etapes.
  can_view_comments: z.boolean().optional(),
  can_view_photos: z.boolean().optional(),
  can_view_documents: z.boolean().optional(),
  can_view_steps: z.boolean().optional(),
  can_view_team: z.boolean().optional(),
  // Modifier reste refuse par defaut, quel que soit le role : c'est ce qui
  // s'appliquait jusqu'ici, et ouvrir ce droit se decide explicitement.
  can_edit: z.boolean().optional().default(false),
});

export const updateChantierMemberSchema = z.object({
  role: z.enum(['manager', 'ouvrier', 'client', 'gestionnaire_reseau']).optional(),
  can_view_comments: z.boolean().optional(),
  can_view_photos: z.boolean().optional(),
  can_view_documents: z.boolean().optional(),
  can_view_steps: z.boolean().optional(),
  can_view_team: z.boolean().optional(),
  can_edit: z.boolean().optional(),
});

/**
 * Qui peut etre mentionne dans un fil : `comments` pour les discussions du
 * chantier et de ses etapes, `emergency` pour le fil d'une urgence.
 */
export const mentionableQuerySchema = z.object({
  chantier_id: z.string().uuid(),
  thread: z.enum(['comments', 'emergency']).default('comments'),
});

/** Une personne mentionnable : son nom, rien d'autre — pas ses coordonnees. */
export type MentionableUser = { id: string; first_name: string; last_name: string };

export type CreateChantierMember = z.infer<typeof createChantierMemberSchema>;
export type UpdateChantierMember = z.infer<typeof updateChantierMemberSchema>;

export type ChantierMemberRow = {
  id: string;
  chantier_id: string;
  user_id: string;
  role: 'manager' | 'ouvrier' | 'client' | 'gestionnaire_reseau';
  can_view_comments: boolean;
  can_view_photos: boolean;
  can_view_documents: boolean;
  can_view_steps: boolean;
  can_view_team: boolean;
  can_edit: boolean;
  created_at: string;
  updated_at: string;
};
