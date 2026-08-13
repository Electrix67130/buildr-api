// Cache TTL en memoire pour la session active de chaque couple (user, plateforme).
// Evite une lecture BDD a chaque requete authentifiee.

const TTL_MS = 30_000; // 30 secondes

export type Platform = 'mobile' | 'web';

const PLATFORMS: Platform[] = ['mobile', 'web'];

interface Entry {
  sessionId: string | null;
  expiresAt: number;
}

const cache = new Map<string, Entry>();

/** Une entree par plateforme : les sessions mobile et web sont independantes. */
function key(userId: string, platform: Platform): string {
  return `${userId}:${platform}`;
}

export function getCachedSessionId(userId: string, platform: Platform): string | null | undefined {
  const entry = cache.get(key(userId, platform));
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key(userId, platform));
    return undefined;
  }
  return entry.sessionId;
}

export function setCachedSessionId(userId: string, platform: Platform, sessionId: string | null): void {
  cache.set(key(userId, platform), { sessionId, expiresAt: Date.now() + TTL_MS });
}

/**
 * Invalide le cache. Sans plateforme precisee, les deux sont purgees — utile
 * pour les actions d'administration qui coupent toutes les sessions.
 */
export function invalidateSessionCache(userId: string, platform?: Platform): void {
  for (const p of platform ? [platform] : PLATFORMS) {
    cache.delete(key(userId, p));
  }
}
