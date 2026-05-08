import { z } from 'zod';

export const createPhotoCommentSchema = z.object({
  photo_id: z.string().uuid(),
  content: z.string().min(1).max(2000),
});

export type CreatePhotoComment = z.infer<typeof createPhotoCommentSchema>;

export type PhotoCommentRow = {
  id: string;
  photo_id: string;
  author_id: string;
  content: string;
  created_at: string;
  updated_at: string;
};
