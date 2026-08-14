import { z } from 'zod';

/**
 * Signalement d'erreur envoye par un client (app mobile ou dashboard).
 *
 * Les longueurs sont plafonnees volontairement : l'endpoint est joignable avec
 * la seule cle d'API, laquelle est embarquee dans le bundle mobile et donc
 * publique. Un plafond evite qu'on s'en serve pour remplir la base.
 */
export const createErrorReportSchema = z.object({
  level: z.enum(['error', 'warn']).optional().default('error'),
  message: z.string().min(1).max(2000),
  stack: z.string().max(10000).optional(),
  source: z.enum(['mobile', 'dashboard']),
  platform: z.enum(['ios', 'android', 'web']).optional(),
  app_version: z.string().max(40).optional(),
  /** Ecran ou composant ou l'erreur s'est produite. */
  screen: z.string().max(200).optional(),
});

export type CreateErrorReport = z.infer<typeof createErrorReportSchema>;

export type ErrorLogRow = {
  id: string;
  level: string;
  message: string;
  stack: string | null;
  route: string | null;
  method: string | null;
  user_id: string | null;
  status_code: number | null;
  request_id: string | null;
  source: string;
  platform: string | null;
  app_version: string | null;
  screen: string | null;
  created_at: string;
};
