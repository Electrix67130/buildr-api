import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  q: z.string().max(200).optional(),
});

export const uuidParamSchema = z.object({ id: z.string().uuid() });

export const chantierFiltersSchema = paginationSchema.extend({
  organization_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  status: z.enum(['a_venir', 'en_cours', 'termine']).optional(),
  archived: z.enum(['true', 'false', 'all']).default('false'),
  sort: z.enum(['created_at', 'name', 'status']).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export type Pagination = z.infer<typeof paginationSchema>;
export type ChantierFilters = z.infer<typeof chantierFiltersSchema>;
