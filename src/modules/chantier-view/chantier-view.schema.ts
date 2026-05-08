import { z } from 'zod';

export const tabEnum = z.enum(['comments', 'photos', 'documents', 'emergencies']);

export const markViewedSchema = z.object({
  chantier_id: z.string().uuid(),
  tab: tabEnum,
});

export type Tab = z.infer<typeof tabEnum>;
export type MarkViewed = z.infer<typeof markViewedSchema>;

export type UnreadCounts = {
  comments: number;
  photos: number;
  documents: number;
  emergencies: number;
};
