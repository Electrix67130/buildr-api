import { Knex } from 'knex';
import { resolveCategories, type ChantierNotificationLevel } from '@/lib/notification-preferences';
import type { ChantierLevelOverride, NotificationPreferences, UpdateCategory } from './notification-preference.schema';

class NotificationPreferenceService {
  constructor(private readonly db: Knex) {}

  async get(userId: string): Promise<NotificationPreferences> {
    const user = await this.db('user').where({ id: userId }).select('push_enabled', 'notification_prefs').first();
    const chantiers = (await this.db('chantier_notification_level')
      .join('chantier', 'chantier.id', 'chantier_notification_level.chantier_id')
      .where('chantier_notification_level.user_id', userId)
      .orderBy('chantier.name')
      .select(
        'chantier_notification_level.chantier_id',
        'chantier.name as chantier_name',
        'chantier_notification_level.level',
      )) as ChantierLevelOverride[];
    return {
      push_enabled: user?.push_enabled ?? true,
      categories: resolveCategories(user?.notification_prefs),
      chantiers,
    };
  }

  /** Une cle a la fois, en place : deux interrupteurs touches vite ne s'ecrasent pas. */
  async updateCategory(userId: string, { category, enabled }: UpdateCategory): Promise<void> {
    await this.db('user')
      .where({ id: userId })
      .update({
        notification_prefs: this.db.raw(
          "jsonb_set(coalesce(notification_prefs, '{}'::jsonb), ?, ?::jsonb, true)",
          [`{${category}}`, JSON.stringify(enabled)],
        ),
        updated_at: this.db.fn.now(),
      });
  }

  async getChantierLevel(userId: string, chantierId: string): Promise<ChantierNotificationLevel> {
    const row = await this.db('chantier_notification_level')
      .where({ user_id: userId, chantier_id: chantierId })
      .select('level')
      .first();
    return (row?.level as ChantierNotificationLevel | undefined) ?? 'all';
  }

  /** « Tout » est le reglage par defaut : on le note en supprimant la ligne. */
  async setChantierLevel(userId: string, chantierId: string, level: ChantierNotificationLevel): Promise<void> {
    if (level === 'all') {
      await this.db('chantier_notification_level').where({ user_id: userId, chantier_id: chantierId }).del();
      return;
    }
    await this.db('chantier_notification_level')
      .insert({ user_id: userId, chantier_id: chantierId, level })
      .onConflict(['user_id', 'chantier_id'])
      .merge({ level, updated_at: this.db.fn.now() });
  }
}

export default NotificationPreferenceService;
