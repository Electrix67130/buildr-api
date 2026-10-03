import { Knex } from 'knex';
import { invalidateSessionCache } from '@/lib/session-cache';
import { closeUserConnections } from '@/lib/realtime-hub';

/**
 * Coupe toutes les sessions d'un utilisateur, tout de suite.
 *
 * Supprimer les jetons de rafraichissement ne suffit pas : cela empeche le
 * renouvellement, pas l'usage. Le jeton d'acces deja emis resterait valable
 * jusqu'a son expiration. Remettre a zero les identifiants de session fait
 * rejeter ce jeton des la requete suivante, le cache est purge dans la
 * foulee, et les WebSocket sont fermees avec un code que les clients
 * reconnaissent pour se deconnecter sans attendre.
 *
 * `account-disabled` : le compte vient d'etre desactive, le client affiche
 * pourquoi. `logout` : coupure sans explication (console).
 */
export async function revokeAllSessions(
  db: Knex,
  userId: string,
  reason: 'logout' | 'account-disabled' = 'logout',
): Promise<number> {
  const deleted = await db('refresh_token').where({ user_id: userId }).del();
  await db('user').where({ id: userId }).update({
    current_mobile_session_id: null,
    current_web_session_id: null,
  });
  invalidateSessionCache(userId);
  closeUserConnections(userId, reason);
  return deleted;
}
