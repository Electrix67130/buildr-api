import { z } from 'zod';

const DOCUMENT_TYPES = ['dict', 'dt', 'bon_de_commande', 'plan', 'arrete', 'facture', 'autre'] as const;

export const createDocumentSchema = z.object({
  chantier_id: z.string().uuid(),
  name: z.string().min(1).max(300),
  type: z.enum(DOCUMENT_TYPES),
  url: z.string().url().max(1000),
  file_size: z.coerce.number().int().positive().optional(),
  mime_type: z.string().max(100).optional(),
});

export type CreateDocument = z.infer<typeof createDocumentSchema>;

export type DocumentRow = {
  id: string;
  chantier_id: string;
  uploaded_by: string;
  name: string;
  type: (typeof DOCUMENT_TYPES)[number];
  url: string;
  file_size?: number;
  mime_type?: string;
  created_at: string;
  updated_at: string;
};
