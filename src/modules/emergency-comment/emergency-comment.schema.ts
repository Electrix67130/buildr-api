import { z } from 'zod';

export const createEmergencyCommentSchema = z.object({
  emergency_id: z.string().uuid(),
  content: z.string().min(1).max(2000),
});

export const updateEmergencyCommentSchema = z.object({
  content: z.string().min(1).max(2000),
});

export type CreateEmergencyComment = z.infer<typeof createEmergencyCommentSchema>;
export type UpdateEmergencyComment = z.infer<typeof updateEmergencyCommentSchema>;

export type EmergencyCommentRow = {
  id: string;
  emergency_id: string;
  author_id: string;
  content: string;
  created_at: string;
  updated_at: string;
};
