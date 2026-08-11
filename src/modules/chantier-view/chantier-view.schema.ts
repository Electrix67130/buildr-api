import { z } from 'zod';

// Onglets et sous-onglets trackes pour la pastille "non lu".
// Note : on garde la compat avec les anciens clients :
//   - `comments`    = messages generaux (step_id IS NULL)
//   - `emergencies` = incidents externes uniquement (type=emergency)
// Les 2 nouveaux types correspondent aux deuxiemes sous-onglets cote mobile :
//   - `comments_steps`     = messages d'etapes (step_id IS NOT NULL)
//   - `emergencies_claim`  = reclamations (type=claim)
export const tabEnum = z.enum([
  'comments',
  'comments_steps',
  'photos',
  'documents',
  'emergencies',
  'emergencies_claim',
]);

export const markViewedSchema = z.object({
  chantier_id: z.string().uuid(),
  tab: tabEnum,
});

export const itemTypeEnum = z.enum(['step', 'emergency']);
export const markItemViewedSchema = z.object({
  item_type: itemTypeEnum,
  item_id: z.string().uuid(),
});

export type Tab = z.infer<typeof tabEnum>;
export type ItemType = z.infer<typeof itemTypeEnum>;
export type MarkViewed = z.infer<typeof markViewedSchema>;
export type MarkItemViewed = z.infer<typeof markItemViewedSchema>;

export type UnreadCounts = {
  comments: number;
  comments_steps: number;
  photos: number;
  documents: number;
  emergencies: number;
  emergencies_claim: number;
  /** IDs des etapes qui ont au moins un commentaire non-lu (pour pastille par-etape) */
  unread_step_ids: string[];
  /** IDs des urgences/reclamations avec activite non-lue (pour pastille par-item) */
  unread_emergency_ids: string[];
};
