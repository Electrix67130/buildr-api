import { z } from 'zod';
import { stripFileToken } from '@/lib/sign-url';

export const createPhotoSchema = z.object({
  chantier_id: z.string().uuid(),
  url: z.string().url().max(1200).transform(stripFileToken),
  thumbnail_url: z.string().url().max(1200).transform(stripFileToken).optional(),
  caption: z.string().max(500).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  taken_at: z.string().optional(),
  file_size: z.coerce.number().int().positive().optional(),
  mime_type: z.string().max(50).optional(),
  /** Etape ou sous-etape que la photo atteste (validation). */
  step_id: z.string().uuid().optional(),
  substep_id: z.string().uuid().optional(),
});

export type CreatePhoto = z.infer<typeof createPhotoSchema>;

export type PhotoRow = {
  id: string;
  chantier_id: string;
  uploaded_by: string;
  url: string;
  thumbnail_url?: string;
  caption?: string;
  latitude?: number;
  longitude?: number;
  taken_at?: string;
  file_size?: number;
  mime_type?: string;
  step_id?: string | null;
  substep_id?: string | null;
  created_at: string;
  updated_at: string;
};
