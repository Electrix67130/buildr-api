import { Knex } from 'knex';

/**
 * Ce que chacun choisit de recevoir.
 *
 * Trois niveaux, du plus large au plus fin :
 * 1. `user.push_enabled` coupe tout ;
 * 2. `user.notification_prefs` coupe une categorie sur tous les chantiers ;
 * 3. `chantier_notification_level` regle un chantier : tout, l'important
 *    (mentions et urgences), ou rien.
 *
 * Tout est actif par defaut : une categorie absente des preferences, un
 * chantier sans reglage, recoivent tout.
 */

export const NOTIFICATION_CATEGORIES = [
  'messages',
  'mentions',
  'emergencies',
  'steps',
  'photos',
  'documents',
  'membership',
  'reports',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const CHANTIER_NOTIFICATION_LEVELS = ['all', 'important', 'none'] as const;
export type ChantierNotificationLevel = (typeof CHANTIER_NOTIFICATION_LEVELS)[number];

/** Ce qui passe encore sur un chantier reglé sur « l'important ». */
const IMPORTANT: readonly NotificationCategory[] = ['mentions', 'emergencies'];

/**
 * La categorie de chaque notification, d'apres son `data.type`. Un type absent
 * n'est jamais filtre : la reponse du support a un signalement, par exemple,
 * repond a une demande de la personne elle-meme.
 */
const CATEGORY_FOR_TYPE: Record<string, NotificationCategory> = {
  comment: 'messages',
  mention: 'mentions',
  emergency: 'emergencies',
  'emergency-comment': 'emergencies',
  'substep-validated': 'steps',
  'step-validated': 'steps',
  photo: 'photos',
  document: 'documents',
  'chantier-member': 'membership',
  report: 'reports',
};

export function categoryForType(type: unknown): NotificationCategory | null {
  return typeof type === 'string' ? (CATEGORY_FOR_TYPE[type] ?? null) : null;
}

/** Les preferences stockees, completees : toute categorie absente est active. */
export function resolveCategories(stored: unknown): Record<NotificationCategory, boolean> {
  const prefs = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  return Object.fromEntries(NOTIFICATION_CATEGORIES.map((c) => [c, prefs[c] !== false])) as Record<
    NotificationCategory,
    boolean
  >;
}

/**
 * Parmi `userIds`, ceux qui veulent recevoir une notification de ce type, sur ce
 * chantier. `push_enabled` est verifie au meme endroit : c'est le premier niveau.
 */
export async function usersAcceptingNotification(
  db: Knex,
  userIds: string[],
  type: unknown,
  chantierId: unknown,
): Promise<{ id: string; locale: string | null }[]> {
  const users = (await db('user')
    .whereIn('id', userIds)
    .where({ push_enabled: true })
    .select('id', 'locale', 'notification_prefs')) as { id: string; locale: string | null; notification_prefs: unknown }[];

  const category = categoryForType(type);
  if (!category) return users.map(({ id, locale }) => ({ id, locale }));

  const levels = new Map<string, string>();
  if (typeof chantierId === 'string' && users.length > 0) {
    const rows = (await db('chantier_notification_level')
      .where({ chantier_id: chantierId })
      .whereIn('user_id', users.map((u) => u.id))
      .select('user_id', 'level')) as { user_id: string; level: string }[];
    for (const row of rows) levels.set(row.user_id, row.level);
  }

  return users
    .filter((u) => resolveCategories(u.notification_prefs)[category])
    .filter((u) => {
      const level = levels.get(u.id);
      if (level === 'none') return false;
      if (level === 'important') return IMPORTANT.includes(category);
      return true;
    })
    .map(({ id, locale }) => ({ id, locale }));
}
