import { z } from 'zod';

/** Nature du signalement. */
export const FEEDBACK_TYPES = ['bug', 'suggestion'] as const;
/** Cycle de vie cote support. */
export const FEEDBACK_STATUSES = ['new', 'in_progress', 'resolved', 'declined'] as const;

export const createFeedbackSchema = z.object({
  type: z.enum(FEEDBACK_TYPES),
  subject: z.string().trim().min(3).max(150),
  message: z.string().trim().min(10).max(5000),
  /** Contexte technique, facultatif : le client le renseigne s'il le connait. */
  platform: z.enum(['mobile', 'web']).optional(),
  app_version: z.string().max(40).optional(),
  screen: z.string().max(200).optional(),
  /**
   * Langue dans laquelle le message est ecrit. C'est celle de l'interface au
   * moment de l'envoi : repondre dans une autre serait inutile.
   */
  locale: z.enum(['fr', 'en', 'de', 'es', 'it', 'pt', 'tr', 'pl']).optional(),
});

/**
 * Traitement d'un signalement par le support.
 *
 * Les deux champs sont facultatifs, mais pas la requete : on refuse un appel
 * vide, qui ne ferait que toucher `updated_at` sans rien dire.
 */
export const respondFeedbackSchema = z
  .object({
    status: z.enum(FEEDBACK_STATUSES).optional(),
    response: z.string().trim().min(1).max(5000).nullable().optional(),
  })
  .refine((data) => data.status !== undefined || data.response !== undefined, {
    message: 'Renseignez au moins un statut ou une reponse',
  });

export const listFeedbackSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(FEEDBACK_STATUSES).optional(),
  type: z.enum(FEEDBACK_TYPES).optional(),
  /** Recherche libre sur le sujet, le message et l'adresse de l'auteur. */
  q: z.string().trim().max(200).optional(),
});

export type CreateFeedback = z.infer<typeof createFeedbackSchema>;
export type RespondFeedback = z.infer<typeof respondFeedbackSchema>;
export type ListFeedback = z.infer<typeof listFeedbackSchema>;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export type FeedbackRow = {
  id: string;
  user_id: string;
  organization_id: string | null;
  type: FeedbackType;
  subject: string;
  message: string;
  status: FeedbackStatus;
  platform: string | null;
  app_version: string | null;
  screen: string | null;
  locale: string;
  response: string | null;
  responded_by: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
};
