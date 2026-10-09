import { Knex } from 'knex';
import type { Permission } from './permissions';
import { usersAcceptingNotification } from './notification-preferences';

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

/**
 * Message a envoyer : soit un texte unique, soit une fonction de la langue du
 * destinataire.
 *
 * La seconde forme existe parce qu'une notification de chantier part a plusieurs
 * personnes a la fois, qui ne parlent pas forcement la meme langue — un chantier
 * peut employer un chef francophone et des ouvriers qui ne le sont pas. La
 * langue passee est celle du compte (`user.locale`), telle quelle : c'est au
 * constructeur de decider quoi faire d'une valeur inconnue.
 */
export type PushContent = PushPayload | ((locale: string) => PushPayload);

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
 * - Skip ceux qui n'en veulent pas : `push_enabled=false`, categorie coupee, ou
 *   chantier mis en sourdine (voir `notification-preferences`)
 * - Resoud tous les tokens valides
 * - Batch + appel Expo Push API
 * - Cleanup les tokens DeviceNotRegistered
 */
export async function sendPushToUsers(
  db: Knex,
  userIds: string[],
  content: PushContent,
  log?: { error: (...args: unknown[]) => void; info?: (...args: unknown[]) => void },
): Promise<void> {
  if (userIds.length === 0) return;

  // Le type et le chantier decident des preferences qui s'appliquent. Ils ne
  // dependent pas de la langue : n'importe quelle version du message les donne.
  const { data } = typeof content === 'function' ? content('fr') : content;

  // Ceux qui veulent cette notification. On lit aussi leur langue : deux
  // destinataires d'une meme notification peuvent la recevoir dans deux langues
  // differentes.
  const enabledUsers = await usersAcceptingNotification(db, userIds, data?.type, data?.chantier_id);
  if (enabledUsers.length === 0) return;

  const enabledIds = enabledUsers.map((u) => u.id);
  const tokenRows = (await db('push_token')
    .whereIn('user_id', enabledIds)
    .select('token', 'user_id')) as { token: string; user_id: string }[];
  if (tokenRows.length === 0) return;

  const localeByUser = new Map(enabledUsers.map((u) => [u.id, u.locale ?? 'fr']));
  // Un texte par langue, pas par destinataire : sur un chantier de trente
  // personnes, le constructeur tourne au plus huit fois.
  const parLangue = new Map<string, PushPayload>();
  const resoudre = (userId: string): PushPayload => {
    if (typeof content !== 'function') return content;
    const langue = localeByUser.get(userId) ?? 'fr';
    let texte = parLangue.get(langue);
    if (!texte) {
      texte = content(langue);
      parLangue.set(langue, texte);
    }
    return texte;
  };

  // L'API d'Expo accepte des messages differents dans un meme lot : traduire ne
  // coute donc aucun appel reseau supplementaire.
  const messages = tokenRows.map((row) => {
    const payload = resoudre(row.user_id);
    return {
      to: row.token,
      sound: payload.sound === null ? null : 'default',
      title: payload.title,
      body: payload.body,
      data: payload.data ?? {},
    };
  });

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
  content: PushContent,
  log?: { error: (...args: unknown[]) => void; info?: (...args: unknown[]) => void },
): Promise<void> {
  return sendPushToUsers(db, [userId], content, log);
}

/**
 * Ce qu'il faut pour voir un contenu du chantier : un drapeau de membre
 * (`view_comments`…), ou seulement d'en faire partie (`participant`, pour les
 * urgences et leur fil).
 */
export type ChantierAccess = Exclude<Permission, 'view_team' | 'edit'> | 'participant';

const ACCESS_COLUMN: Record<Exclude<ChantierAccess, 'participant'>, string> = {
  view_comments: 'can_view_comments',
  view_photos: 'can_view_photos',
  view_documents: 'can_view_documents',
  view_steps: 'can_view_steps',
};

/**
 * Les personnes qui voient ce contenu du chantier : son createur, les
 * administrateurs de son organisation, et les membres qui y ont acces.
 *
 * Avant, une notification partait a TOUS les membres. Un gestionnaire reseau,
 * qui n'a pas acces aux discussions, recevait pourtant chaque message — texte
 * compris — dans ses notifications.
 */
export async function chantierAudience(db: Knex, chantierId: string, access: ChantierAccess): Promise<string[]> {
  const chantier = await db('chantier')
    .where({ id: chantierId })
    .select('organization_id', 'created_by')
    .first();
  if (!chantier) return [];

  const userIds = new Set<string>();
  userIds.add(chantier.created_by);

  const admins = (await db('organization_member')
    .where({ organization_id: chantier.organization_id, role: 'admin' })
    .select('user_id')) as { user_id: string }[];
  for (const a of admins) userIds.add(a.user_id);

  const members = db('chantier_member').where({ chantier_id: chantierId });
  if (access !== 'participant') members.where(ACCESS_COLUMN[access], true);
  for (const m of (await members.select('user_id')) as { user_id: string }[]) userIds.add(m.user_id);

  return [...userIds];
}

/** Ceux qui ont bloque `authorId` : ils ne lisent plus ses messages, ils ne doivent pas en etre prevenus. */
async function usersWhoBlocked(db: Knex, authorId: string): Promise<Set<string>> {
  const rows = (await db('user_block').where({ blocked_id: authorId }).select('blocker_id')) as { blocker_id: string }[];
  return new Set(rows.map((r) => r.blocker_id));
}

/**
 * Push a ceux qui voient ce contenu du chantier (voir `chantierAudience`),
 * sauf l'acteur. L'acteur est aussi l'auteur du contenu : ceux qui l'ont bloque
 * ne sont pas prevenus. `alsoExclude` retire d'autres personnes — celles qu'un
 * message mentionne, qui recoivent deja la notification de mention.
 */
export async function sendPushToChantier(
  db: Knex,
  chantierId: string,
  actorId: string | null,
  content: PushContent,
  log: { error: (...args: unknown[]) => void; info?: (...args: unknown[]) => void } | undefined,
  options: { access: ChantierAccess; alsoExclude?: string[] },
): Promise<void> {
  const audience = await chantierAudience(db, chantierId, options.access);
  const excluded = new Set(options.alsoExclude ?? []);
  if (actorId) {
    excluded.add(actorId);
    for (const id of await usersWhoBlocked(db, actorId)) excluded.add(id);
  }
  return sendPushToUsers(db, audience.filter((id) => !excluded.has(id)), content, log);
}

/**
 * Notification de mention : seulement aux personnes mentionnees qui voient le
 * message, pas a l'auteur, pas a ceux qui l'ont bloque. Renvoie ceux qui
 * comptent comme prevenus, pour les retirer de la notification ordinaire.
 */
export async function sendMentionPush(
  db: Knex,
  chantierId: string,
  authorId: string,
  mentionedIds: string[],
  content: PushContent,
  log: { error: (...args: unknown[]) => void; info?: (...args: unknown[]) => void } | undefined,
  access: ChantierAccess,
): Promise<string[]> {
  if (mentionedIds.length === 0) return [];
  const audience = new Set(await chantierAudience(db, chantierId, access));
  const blockers = await usersWhoBlocked(db, authorId);
  const recipients = mentionedIds.filter((id) => id !== authorId && audience.has(id) && !blockers.has(id));
  await sendPushToUsers(db, recipients, content, log);
  return recipients;
}
