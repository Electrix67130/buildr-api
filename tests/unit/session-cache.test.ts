import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getCachedSessionId, setCachedSessionId, invalidateSessionCache } from '@/lib/session-cache';

/**
 * Cache des sessions actives.
 *
 * Il evite une lecture en base a chaque requete authentifiee, et se place donc
 * devant le controle qui rejette les jetons d'une session revoquee. Une erreur
 * ici ne se voit pas : soit on refuse des gens legitimes, soit on laisse passer
 * des sessions qui auraient du etre coupees.
 */
describe('Cache des sessions', () => {
  const USER = 'u-1';

  beforeEach(() => {
    vi.useFakeTimers();
    invalidateSessionCache(USER);
    invalidateSessionCache('u-2');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('distingue « rien en cache » de « pas de session »', () => {
    // La difference decide du comportement de l'authentification : undefined
    // declenche une lecture en base, null signifie qu'on sait deja qu'aucune
    // session n'existe. Les confondre ferait relire la base a chaque requete,
    // ou pire, accepter un jeton sans verification.
    expect(getCachedSessionId(USER, 'web')).toBeUndefined();

    setCachedSessionId(USER, 'web', null);

    expect(getCachedSessionId(USER, 'web')).toBeNull();
  });

  it('rend la session enregistree', () => {
    setCachedSessionId(USER, 'web', 'session-abc');

    expect(getCachedSessionId(USER, 'web')).toBe('session-abc');
  });

  it('oublie la session au bout de trente secondes', () => {
    setCachedSessionId(USER, 'web', 'session-abc');

    vi.advanceTimersByTime(29_000);
    expect(getCachedSessionId(USER, 'web')).toBe('session-abc');

    vi.advanceTimersByTime(2_000);
    expect(getCachedSessionId(USER, 'web')).toBeUndefined();
  });

  it('repousse la peremption a chaque enregistrement', () => {
    setCachedSessionId(USER, 'web', 'session-abc');
    vi.advanceTimersByTime(25_000);
    setCachedSessionId(USER, 'web', 'session-def');

    vi.advanceTimersByTime(25_000);

    expect(getCachedSessionId(USER, 'web')).toBe('session-def');
  });

  it('tient les deux plateformes separement', () => {
    // Se connecter sur le mobile ne doit pas deconnecter le dashboard : les
    // deux sessions sont independantes, leur cache aussi.
    setCachedSessionId(USER, 'web', 'session-web');
    setCachedSessionId(USER, 'mobile', 'session-mobile');

    expect(getCachedSessionId(USER, 'web')).toBe('session-web');
    expect(getCachedSessionId(USER, 'mobile')).toBe('session-mobile');
  });

  it('ne melange pas deux utilisateurs', () => {
    setCachedSessionId(USER, 'web', 'session-1');
    setCachedSessionId('u-2', 'web', 'session-2');

    expect(getCachedSessionId(USER, 'web')).toBe('session-1');
    expect(getCachedSessionId('u-2', 'web')).toBe('session-2');
  });

  describe('invalidation', () => {
    beforeEach(() => {
      setCachedSessionId(USER, 'web', 'session-web');
      setCachedSessionId(USER, 'mobile', 'session-mobile');
    });

    it("ne purge que la plateforme demandee", () => {
      invalidateSessionCache(USER, 'web');

      expect(getCachedSessionId(USER, 'web')).toBeUndefined();
      expect(getCachedSessionId(USER, 'mobile')).toBe('session-mobile');
    });

    it('purge les deux quand aucune plateforme n est precisee', () => {
      // Le cas des actions d'administration qui coupent toutes les sessions.
      invalidateSessionCache(USER);

      expect(getCachedSessionId(USER, 'web')).toBeUndefined();
      expect(getCachedSessionId(USER, 'mobile')).toBeUndefined();
    });

    it("ne touche pas aux autres utilisateurs", () => {
      setCachedSessionId('u-2', 'web', 'session-2');

      invalidateSessionCache(USER);

      expect(getCachedSessionId('u-2', 'web')).toBe('session-2');
    });
  });
});
