import { z } from 'zod';
import { stripFileToken } from '@/lib/sign-url';

/** Une photo jointe a une urgence : le resultat de /upload. */
export const emergencyPhotoInputSchema = z.object({
  url: z.string().max(1200).transform(stripFileToken),
  thumbnail_url: z.string().max(1200).transform(stripFileToken).optional(),
  file_size: z.coerce.number().int().positive().optional(),
  mime_type: z.string().max(50).optional(),
});

export const addEmergencyPhotosSchema = z.object({
  photos: z.array(emergencyPhotoInputSchema).min(1).max(20),
});

export const createEmergencySchema = z.object({
  chantier_id: z.string().uuid(),
  /** Ancienne forme, une seule photo : toujours acceptee. */
  photo_url: z.string().max(1200).transform(stripFileToken).optional(),
  thumbnail_url: z.string().max(1200).transform(stripFileToken).optional(),
  /** Nouvelle forme : plusieurs photos. La premiere devient `photo_url`. */
  photos: z.array(emergencyPhotoInputSchema).max(20).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  description: z.string().max(2000).optional(),
});

export type CreateEmergency = z.infer<typeof createEmergencySchema>;
export type EmergencyPhotoInput = z.infer<typeof emergencyPhotoInputSchema>;

/** Vignette d'une photo d'urgence. */
export type EmergencyPhoto = {
  id: string;
  url: string;
  thumbnail_url: string | null;
  created_at: string;
};

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

export type EmergencyWithMeta = EmergencyRow & {
  first_name: string;
  last_name: string;
  type: 'emergency' | 'claim';
  photos: EmergencyPhoto[];
};
