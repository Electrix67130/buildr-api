import { z } from 'zod';
import {
  NOTIFICATION_CATEGORIES,
  CHANTIER_NOTIFICATION_LEVELS,
  type NotificationCategory,
  type ChantierNotificationLevel,
} from '@/lib/notification-preferences';

/** Active ou coupe une categorie, sur tous les chantiers. */
export const updateCategorySchema = z.object({
  category: z.enum(NOTIFICATION_CATEGORIES),
  enabled: z.boolean(),
});

/** Le reglage d'un chantier : tout, l'important (mentions et urgences), ou rien. */
export const chantierLevelSchema = z.object({
  level: z.enum(CHANTIER_NOTIFICATION_LEVELS),
});

export const chantierParamsSchema = z.object({
  chantierId: z.string().uuid(),
});

export type UpdateCategory = z.infer<typeof updateCategorySchema>;

/** Un chantier dont le reglage n'est pas « tout ». */
export type ChantierLevelOverride = {
  chantier_id: string;
  chantier_name: string;
  level: Exclude<ChantierNotificationLevel, 'all'>;
};

export type NotificationPreferences = {
  push_enabled: boolean;
  categories: Record<NotificationCategory, boolean>;
  chantiers: ChantierLevelOverride[];
};
