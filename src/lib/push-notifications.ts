import { Knex } from 'knex';

/**
 * Envoi de push notifications via le service Expo Push.
 * Doc : https://docs.expo.dev/push-notifications/sending-notifications/
 *
 * On regroupe les tokens en batchs de 100 max (limite de l'API Expo) et on
 * gere les `DeviceNotRegistered` en supprimant les tokens devenus invalides.
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH_SIZE = 100;

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Type de son ('default' = son par defaut, null = silencieux). */
  sound?: 'default' | null;
}

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoPushResponse {
  data?: ExpoPushTicket[];
  errors?: Array<{ code: string; message: string }>;
}

/**
 * Envoie une notification a un ou plusieurs users.
 * - Skip si l'user a `push_enabled=false`
 * - Resoud tous les tokens valides
 * - Batch + appel Expo Push API
 * - Cleanup les tokens DeviceNotRegistered
 */
export async function sendPushToUsers(
  db: Knex,
  userIds: string[],
  payload: PushPayload,
  log?: { error: (...args: unknown[]) => void; info?: (...args: unknown[]) => void },
): Promise<void> {
  if (userIds.length === 0) return;

  // Filtrer les users avec push_enabled=true
  const enabledUsers = (await db('user')
    .whereIn('id', userIds)
    .where({ push_enabled: true })
    .select('id')) as { id: string }[];
  if (enabledUsers.length === 0) return;

  const enabledIds = enabledUsers.map((u) => u.id);
  const tokenRows = (await db('push_token')
    .whereIn('user_id', enabledIds)
    .select('token')) as { token: string }[];
  if (tokenRows.length === 0) return;

  const messages = tokenRows.map((row) => ({
    to: row.token,
    sound: payload.sound === null ? null : 'default',
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
  }));

  // Batch d'envoi.
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify(batch),
      });
      const body = (await res.json()) as ExpoPushResponse;
      const tickets = body.data ?? [];

      // Cleanup tokens DeviceNotRegistered (token expire / app desinstallee).
      const invalidTokens: string[] = [];
      tickets.forEach((ticket, idx) => {
        if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
          invalidTokens.push(batch[idx].to);
        } else if (ticket.status === 'error') {
          log?.error?.({ ticket }, 'Push error');
        }
      });
      if (invalidTokens.length > 0) {
        await db('push_token').whereIn('token', invalidTokens).del();
      }
    } catch (err) {
      log?.error?.({ err }, 'Expo Push request failed');
    }
  }
}

/**
 * Convenience : push a un seul user.
 */
export async function sendPushToUser(
  db: Knex,
  userId: string,
  payload: PushPayload,
  log?: { error: (...args: unknown[]) => void; info?: (...args: unknown[]) => void },
): Promise<void> {
  return sendPushToUsers(db, [userId], payload, log);
}

/**
 * Push a tous les destinataires legitimes d'un chantier (membres + admin org +
 * createur), excluant l'acteur (excludeUserId).
 */
export async function sendPushToChantier(
  db: Knex,
  chantierId: string,
  excludeUserId: string | null,
  payload: PushPayload,
  log?: { error: (...args: unknown[]) => void; info?: (...args: unknown[]) => void },
): Promise<void> {
  const chantier = await db('chantier')
    .where({ id: chantierId })
    .select('organization_id', 'created_by')
    .first();
  if (!chantier) return;

  const userIds = new Set<string>();
  userIds.add(chantier.created_by);

  const admins = (await db('organization_member')
    .where({ organization_id: chantier.organization_id, role: 'admin' })
    .select('user_id')) as { user_id: string }[];
  for (const a of admins) userIds.add(a.user_id);

  const members = (await db('chantier_member')
    .where({ chantier_id: chantierId })
    .select('user_id')) as { user_id: string }[];
  for (const m of members) userIds.add(m.user_id);

  if (excludeUserId) userIds.delete(excludeUserId);

  return sendPushToUsers(db, Array.from(userIds), payload, log);
}
