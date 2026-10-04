import { z } from 'zod';
import { stripFileToken } from '@/lib/sign-url';

export const createEmergencySchema = z.object({
  chantier_id: z.string().uuid(),
  photo_url: z.string().max(1200).transform(stripFileToken).optional(),
  thumbnail_url: z.string().max(1200).transform(stripFileToken).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  description: z.string().max(2000).optional(),
});

export type CreateEmergency = z.infer<typeof createEmergencySchema>;

export type EmergencyRow = {
  id: string;
  chantier_id: string;
  created_by: string;
  photo_url: string | null;
  thumbnail_url: string | null;
  latitude: number | null;
  longitude: number | null;
  description: string | null;
  created_at: string;
  updated_at: string;
};
