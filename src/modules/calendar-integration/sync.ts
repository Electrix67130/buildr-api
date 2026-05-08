import { Knex } from 'knex';
import type { FastifyBaseLogger } from 'fastify';
import { ChantierRow } from '@/modules/chantier/chantier.schema';
import { CalendarEventLinkRow, CalendarIntegrationRow } from './calendar-integration.schema';
import CalendarIntegrationService from './calendar-integration.service';
import * as google from './providers/google';
import * as outlook from './providers/outlook';

type Logger = Pick<FastifyBaseLogger, 'error' | 'warn' | 'info'>;

interface PushPayload {
  summary: string;
  description?: string;
  location?: string;
  startDate: string;
  endDate: string;
}

// Knex renvoie les colonnes PostgreSQL `date` comme des objets Date JS — tous les
// providers attendent du YYYY-MM-DD, donc on coerce ici une fois pour toutes.
function toIsoDate(value: string | Date): string {
  return typeof value === 'string' ? value : value.toISOString().slice(0, 10);
}

function payloadFromChantier(c: ChantierRow): PushPayload | null {
  if (!c.start_date || !c.end_date) return null;
  return {
    summary: c.name,
    description: c.description,
    location: [c.address, c.postal_code, c.city].filter(Boolean).join(', ') || undefined,
    startDate: toIsoDate(c.start_date),
    endDate: toIsoDate(c.end_date),
  };
}

/** Fire-and-forget wrapper: never throws, never blocks the caller. */
export function fireAndForget(fn: () => Promise<void>, logger?: Logger): void {
  setImmediate(() => {
    fn().catch((err) => {
      if (logger) logger.error({ err }, 'calendar sync failed');
      else console.error('calendar sync failed', err);
    });
  });
}

async function pushChantierForIntegration(
  db: Knex,
  service: CalendarIntegrationService,
  integration: CalendarIntegrationRow,
  chantier: ChantierRow,
  payload: PushPayload,
): Promise<void> {
  if (integration.provider === 'apple') return; // pull-based — no push needed

  const refreshToken = service.decryptRefreshToken(integration);
  const existingLink: CalendarEventLinkRow | undefined = await db('calendar_event_link')
    .where({ integration_id: integration.id, chantier_id: chantier.id })
    .first();

  if (integration.provider === 'google') {
    const accessToken = await google.refreshAccessToken(refreshToken);
    const calendarId = integration.external_calendar_id || 'primary';
    if (existingLink) {
      await google.updateEvent(accessToken, calendarId, existingLink.external_event_id, payload);
      await db('calendar_event_link').where({ id: existingLink.id }).update({ updated_at: db.fn.now() });
    } else {
      const eventId = await google.createEvent(accessToken, calendarId, payload);
      await db('calendar_event_link').insert({
        integration_id: integration.id,
        chantier_id: chantier.id,
        external_event_id: eventId,
      });
    }
  } else if (integration.provider === 'outlook') {
    const accessToken = await outlook.refreshAccessToken(refreshToken);
    if (existingLink) {
      await outlook.updateEvent(accessToken, existingLink.external_event_id, payload);
      await db('calendar_event_link').where({ id: existingLink.id }).update({ updated_at: db.fn.now() });
    } else {
      const eventId = await outlook.createEvent(accessToken, payload);
      await db('calendar_event_link').insert({
        integration_id: integration.id,
        chantier_id: chantier.id,
        external_event_id: eventId,
      });
    }
  }

  await service.markSynced(integration.id);
}

async function deleteChantierForIntegration(
  db: Knex,
  service: CalendarIntegrationService,
  integration: CalendarIntegrationRow,
  chantierId: string,
): Promise<void> {
  if (integration.provider === 'apple') return;

  const link: CalendarEventLinkRow | undefined = await db('calendar_event_link')
    .where({ integration_id: integration.id, chantier_id: chantierId })
    .first();
  if (!link) return;

  const refreshToken = service.decryptRefreshToken(integration);
  if (integration.provider === 'google') {
    const accessToken = await google.refreshAccessToken(refreshToken);
    const calendarId = integration.external_calendar_id || 'primary';
    await google.deleteEvent(accessToken, calendarId, link.external_event_id);
  } else if (integration.provider === 'outlook') {
    const accessToken = await outlook.refreshAccessToken(refreshToken);
    await outlook.deleteEvent(accessToken, link.external_event_id);
  }

  await db('calendar_event_link').where({ id: link.id }).del();
}

/** A user was added to a chantier (or the chantier was created with them as owner). */
export async function syncMemberAdded(db: Knex, chantierId: string, userId: string, logger?: Logger): Promise<void> {
  const chantier = (await db('chantier').where({ id: chantierId }).first()) as ChantierRow | undefined;
  if (!chantier) return;
  const payload = payloadFromChantier(chantier);
  if (!payload) return;

  const service = new CalendarIntegrationService(db);
  const integrations = await service.findByUser(userId);
  for (const integration of integrations) {
    try {
      await pushChantierForIntegration(db, service, integration, chantier, payload);
    } catch (err) {
      logger?.warn({ err, integrationId: integration.id, chantierId }, 'sync member added failed for integration');
    }
  }
}

/** A user was removed from a chantier — delete the event from their connected calendars. */
export async function syncMemberRemoved(db: Knex, chantierId: string, userId: string, logger?: Logger): Promise<void> {
  const service = new CalendarIntegrationService(db);
  const integrations = await service.findByUser(userId);
  for (const integration of integrations) {
    try {
      await deleteChantierForIntegration(db, service, integration, chantierId);
    } catch (err) {
      logger?.warn({ err, integrationId: integration.id, chantierId }, 'sync member removed failed for integration');
    }
  }
}

/** Chantier dates (or other event-affecting fields) changed — update events for every member. */
export async function syncChantierUpdated(db: Knex, chantierId: string, logger?: Logger): Promise<void> {
  const chantier = (await db('chantier').where({ id: chantierId }).first()) as ChantierRow | undefined;
  if (!chantier) return;
  const payload = payloadFromChantier(chantier);
  if (!payload) return;

  const memberIds: string[] = (
    await db('chantier_member').where({ chantier_id: chantierId }).select('user_id')
  ).map((r: { user_id: string }) => r.user_id);
  if (chantier.created_by && !memberIds.includes(chantier.created_by)) memberIds.push(chantier.created_by);

  const service = new CalendarIntegrationService(db);
  for (const userId of memberIds) {
    const integrations = await service.findByUser(userId);
    for (const integration of integrations) {
      try {
        await pushChantierForIntegration(db, service, integration, chantier, payload);
      } catch (err) {
        logger?.warn({ err, integrationId: integration.id, chantierId }, 'sync chantier updated failed for integration');
      }
    }
  }
}

/** Chantier was deleted — clean up all linked events. */
export async function syncChantierDeleted(db: Knex, chantierId: string, logger?: Logger): Promise<void> {
  const links: CalendarEventLinkRow[] = await db('calendar_event_link').where({ chantier_id: chantierId });
  if (!links.length) return;

  const service = new CalendarIntegrationService(db);
  for (const link of links) {
    const integration = await service.findById(link.integration_id);
    if (!integration) continue;
    try {
      await deleteChantierForIntegration(db, service, integration, chantierId);
    } catch (err) {
      logger?.warn({ err, integrationId: integration.id, chantierId }, 'sync chantier deleted failed for integration');
    }
  }
}
