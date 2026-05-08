import { Knex } from 'knex';
import BaseService from '@/lib/base-service';
import { encryptSecret, decryptSecret, randomToken } from '@/lib/crypto';
import { CalendarIntegrationRow, CalendarProvider } from './calendar-integration.schema';

class CalendarIntegrationService extends BaseService<CalendarIntegrationRow> {
  constructor(db: Knex) {
    super(db, 'calendar_integration');
  }

  async findByUser(userId: string): Promise<CalendarIntegrationRow[]> {
    return this.db(this.table).where({ user_id: userId }) as Promise<CalendarIntegrationRow[]>;
  }

  async findByUserAndProvider(userId: string, provider: CalendarProvider): Promise<CalendarIntegrationRow | undefined> {
    return this.db(this.table).where({ user_id: userId, provider }).first() as Promise<CalendarIntegrationRow | undefined>;
  }

  async findByIcalToken(token: string): Promise<CalendarIntegrationRow | undefined> {
    return this.db(this.table).where({ ical_token: token, provider: 'apple' }).first() as Promise<
      CalendarIntegrationRow | undefined
    >;
  }

  /** Connect (or update) an OAuth-based integration (google/outlook). Encrypts the refresh token. */
  async upsertOAuth(
    userId: string,
    provider: 'google' | 'outlook',
    refreshToken: string,
    externalCalendarId: string,
  ): Promise<CalendarIntegrationRow> {
    const encrypted = encryptSecret(refreshToken);
    const existing = await this.findByUserAndProvider(userId, provider);

    if (existing) {
      const [row] = await this.db(this.table)
        .where({ id: existing.id })
        .update({
          refresh_token_encrypted: encrypted,
          external_calendar_id: externalCalendarId,
          updated_at: this.db.fn.now(),
        })
        .returning('*');
      return row as CalendarIntegrationRow;
    }

    const [row] = await this.db(this.table)
      .insert({
        user_id: userId,
        provider,
        refresh_token_encrypted: encrypted,
        external_calendar_id: externalCalendarId,
      })
      .returning('*');
    return row as CalendarIntegrationRow;
  }

  /** Generate (or reuse) an Apple iCal subscribe token for this user. */
  async ensureAppleIntegration(userId: string): Promise<CalendarIntegrationRow> {
    const existing = await this.findByUserAndProvider(userId, 'apple');
    if (existing) return existing;

    const [row] = await this.db(this.table)
      .insert({ user_id: userId, provider: 'apple', ical_token: randomToken(32) })
      .returning('*');
    return row as CalendarIntegrationRow;
  }

  /** Decrypt the refresh token in memory (never log this). */
  decryptRefreshToken(integration: CalendarIntegrationRow): string {
    if (!integration.refresh_token_encrypted) {
      throw new Error('Integration has no encrypted refresh token');
    }
    return decryptSecret(integration.refresh_token_encrypted);
  }

  async markSynced(id: string): Promise<void> {
    await this.db(this.table).where({ id }).update({ last_sync_at: this.db.fn.now() });
  }

  async disconnect(userId: string, provider: CalendarProvider): Promise<boolean> {
    const deleted = await this.db(this.table).where({ user_id: userId, provider }).del();
    return deleted > 0;
  }
}

export default CalendarIntegrationService;
