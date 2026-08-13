import { Knex } from 'knex';
import type { Platform } from '@/lib/session-cache';
import { WebSocket } from 'ws';

/**
 * Hub temps reel : tient en memoire la liste des WebSocket actifs par user.
 * Permet de pousser des events vers un user specifique ou vers tous les
 * users qui ont acces a un chantier.
 */

export type RealtimeEventType =
  | 'comment.created'
  | 'comment.updated'
  | 'comment.deleted'
  | 'photo.created'
  | 'photo.deleted'
  | 'document.created'
  | 'document.deleted'
  | 'emergency.created'
  | 'emergency.deleted'
  | 'emergency-comment.created'
  | 'emergency-comment.updated'
  | 'emergency-comment.deleted'
  | 'chantier-member.created'
  | 'chantier-member.updated'
  | 'chantier-member.deleted';

export interface RealtimeEvent {
  type: RealtimeEventType;
  chantier_id: string;
  resource_id?: string;
  actor_id?: string;
}

const connections = new Map<string, Set<WebSocket>>();

/**
 * Plateforme d'origine de chaque socket. Stockee a cote plutot que dans la cle
 * des connexions : les emissions d'evenements ciblent un utilisateur, toutes
 * plateformes confondues, et n'ont pas a s'en soucier. Seule la fermeture de
 * session a besoin de distinguer, pour ne pas couper le dashboard quand le
 * mobile se reconnecte.
 */
const socketPlatform = new WeakMap<WebSocket, Platform>();

export function addConnection(userId: string, ws: WebSocket, platform?: Platform): void {
  let set = connections.get(userId);
  if (!set) {
    set = new Set();
    connections.set(userId, set);
  }
  set.add(ws);
  if (platform) socketPlatform.set(ws, platform);
}

export function removeConnection(userId: string, ws: WebSocket): void {
  const set = connections.get(userId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) connections.delete(userId);
}

export function emitToUser(userId: string, event: RealtimeEvent): void {
  const set = connections.get(userId);
  if (!set) return;
  const payload = JSON.stringify(event);
  for (const ws of set) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

/**
 * Emet l'event a tous les users qui ont acces au chantier :
 * - admin de l'org du chantier
 * - createur du chantier
 * - membres du chantier (chantier_member)
 *
 * On exclut l'auteur de l'action lui-meme (event.actor_id) — il a deja l'info
 * via la mutation locale, pas la peine de le re-notifier.
 */
export async function emitToChantier(
  db: Knex,
  chantierId: string,
  event: RealtimeEvent,
): Promise<void> {
  const chantier = await db('chantier')
    .where({ id: chantierId })
    .select('organization_id', 'created_by')
    .first();
  if (!chantier) return;

  const userIds = new Set<string>();

  // Createur du chantier.
  userIds.add(chantier.created_by);

  // Admins de l'org du chantier (via organization_member).
  const admins = (await db('organization_member')
    .where({ organization_id: chantier.organization_id, role: 'admin' })
    .select('user_id')) as { user_id: string }[];
  for (const a of admins) userIds.add(a.user_id);

  // Membres du chantier.
  const members = (await db('chantier_member')
    .where({ chantier_id: chantierId })
    .select('user_id')) as { user_id: string }[];
  for (const m of members) userIds.add(m.user_id);

  // On retire l'acteur — pas besoin de se notifier soi-meme.
  if (event.actor_id) userIds.delete(event.actor_id);

  for (const userId of userIds) {
    emitToUser(userId, event);
  }
}

/**
 * Force la fermeture de toutes les connexions d'un user.
 * Codes utilises :
 * - 'logout' (code 1000) : logout volontaire
 * - 'session-replaced' (code 4001) : nouvelle connexion ailleurs (single-session)
 *   Le frontend reconnait ce code custom pour declencher un logout immediat.
 */
export function closeUserConnections(
  userId: string,
  reason: 'logout' | 'session-replaced' = 'logout',
  platform?: Platform,
): void {
  const set = connections.get(userId);
  if (!set) return;
  const code = reason === 'session-replaced' ? 4001 : 1000;

  for (const ws of set) {
    // Sans plateforme precisee on ferme tout (action d'administration, logout
    // d'un client anterieur a la separation des sessions). Sinon on ne ferme
    // que les sockets de la plateforme concernee ; celles d'origine inconnue
    // sont conservees plutot que coupees a tort.
    if (platform && socketPlatform.get(ws) !== platform) continue;
    try {
      ws.close(code, reason);
    } catch {
      // ignore
    }
    set.delete(ws);
  }

  if (set.size === 0) connections.delete(userId);
}

export function activeUserCount(): number {
  return connections.size;
}
