import { z } from 'zod';

export const createChantierMemberSchema = z.object({
  chantier_id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: z.enum(['manager', 'ouvrier', 'client', 'gestionnaire_reseau']).optional().default('ouvrier'),
  can_view_comments: z.boolean().optional().default(true),
  can_view_photos: z.boolean().optional().default(true),
  can_view_documents: z.boolean().optional().default(true),
  can_view_steps: z.boolean().optional().default(true),
  can_view_team: z.boolean().optional().default(true),
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
