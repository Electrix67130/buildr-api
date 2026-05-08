import { z } from 'zod';

export const createChantierSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  postal_code: z.string().max(10).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  status: z.enum(['a_venir', 'en_cours', 'termine']).optional().default('a_venir'),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  manager_id: z.string().uuid().optional(),
});

export const updateChantierSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  postal_code: z.string().max(10).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  status: z.enum(['a_venir', 'en_cours', 'termine']).optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

export const setRetentionSchema = z.object({
  years: z.coerce.number().int().min(1).max(10),
});

export const searchChantierSchema = z.object({
  q: z.string().max(200).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radius_km: z.coerce.number().min(0.1).max(500).default(50).optional(),
  status: z.enum(['a_venir', 'en_cours', 'termine']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateChantier = z.infer<typeof createChantierSchema>;
export type UpdateChantier = z.infer<typeof updateChantierSchema>;
export type SearchChantier = z.infer<typeof searchChantierSchema>;
export type SetRetention = z.infer<typeof setRetentionSchema>;

export type ChantierRow = {
  id: string;
  name: string;
  description?: string;
  address?: string;
  city?: string;
  postal_code?: string;
  latitude?: number;
  longitude?: number;
  status: 'a_venir' | 'en_cours' | 'termine';
  start_date?: string;
  end_date?: string;
  created_by: string;
  organization_id: string;
  archived_at?: string;
  auto_delete_at?: string;
  created_at: string;
  updated_at: string;
};
