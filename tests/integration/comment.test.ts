import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { createTestApp, auth } from '../helpers/app';
import { addConnection, removeConnection } from '@/lib/realtime-hub';
import { truncateAll } from '../helpers/db';
import { createOrgWithAdmin, createUser, type TestUser } from '../helpers/factories';

/**
 * Discussions : repondre a un message precis, reagir d'un emoji.
 *
 * La citation ne doit jamais faire sortir un extrait de son chantier, et une
 * reaction est un interrupteur : la poser deux fois la retire.
 */
describe('Discussions : reponses et reactions', () => {
  let app: FastifyInstance;
  let organizationId: string;
  let admin: TestUser;
  let ouvrier: TestUser;
  let sansDroit: TestUser;
  let chantierId: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const poster = (token: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/comments', headers: auth(token), payload: { chantier_id: chantierId, content: 'Bonjour', ...payload } });
  const lister = (token = admin.token) =>
    app.inject({ method: 'GET', url: `/comments?chantier_id=${chantierId}&order=asc`, headers: auth(token) }).then((r) => r.json().data);
  const reagir = (token: string, id: string, emoji: string) =>
    app.inject({ method: 'POST', url: `/comments/${id}/reactions`, headers: auth(token), payload: { emoji } });

  beforeEach(async () => {
    await truncateAll(app.db);
    const org = await createOrgWithAdmin(app, 'Alpha TP');
    organizationId = org.organizationId;
    admin = org.admin;
    ouvrier = await createUser(app, { organizationId, role: 'employee' });
    sansDroit = await createUser(app, { organizationId, role: 'employee' });
    chantierId = (await app.inject({ method: 'POST', url: '/chantiers', headers: auth(admin.token), payload: { name: 'Pont' } })).json().id;
    await app.inject({ method: 'POST', url: '/chantier-members', headers: auth(admin.token), payload: { chantier_id: chantierId, user_id: ouvrier.id, role: 'ouvrier', can_view_comments: true } });
    await app.inject({ method: 'POST', url: '/chantier-members', headers: auth(admin.token), payload: { chantier_id: chantierId, user_id: sansDroit.id, role: 'ouvrier', can_view_comments: false } });
  });

  describe('repondre', () => {
    it('cite le message vise, avec son auteur', async () => {
      const original = (await poster(admin.token, { content: 'Le beton arrive a 14h' })).json();

      const res = await poster(ouvrier.token, { content: 'Bien recu', reply_to_id: original.id });

      expect(res.statusCode).toBe(201);
      const [, reponse] = await lister();
      expect(reponse.reply_to).toMatchObject({ id: original.id, content: 'Le beton arrive a 14h', author_id: admin.id });
      expect(reponse.reply_to.first_name).toBeTruthy();
    });

    it("refuse de citer un message d'un autre chantier", async () => {
      const autre = (await app.inject({ method: 'POST', url: '/chantiers', headers: auth(admin.token), payload: { name: 'Autre' } })).json();
      const ailleurs = (await app.inject({ method: 'POST', url: '/comments', headers: auth(admin.token), payload: { chantier_id: autre.id, content: 'Secret' } })).json();

      const res = await poster(admin.token, { reply_to_id: ailleurs.id });

      expect(res.statusCode).toBe(400);
    });

    it('garde la reponse sans citation quand le message cite est supprime', async () => {
      const original = (await poster(admin.token, { content: 'A supprimer' })).json();
      await poster(ouvrier.token, { content: 'Reponse', reply_to_id: original.id });

      await app.inject({ method: 'DELETE', url: `/comments/${original.id}`, headers: auth(admin.token) });

      const liste = await lister();
      expect(liste).toHaveLength(1);
      expect(liste[0].content).toBe('Reponse');
      expect(liste[0].reply_to).toBeNull();
    });
  });

  describe('reagir', () => {
    it("compte les reactions par emoji, et dit si c'est la mienne", async () => {
      const message = (await poster(admin.token, {})).json();
      await reagir(admin.token, message.id, '👍');
      await reagir(ouvrier.token, message.id, '👍');
      await reagir(ouvrier.token, message.id, '🔥');

      const [pourAdmin] = await lister(admin.token);
      const [pourOuvrier] = await lister(ouvrier.token);

      expect(pourAdmin.reactions).toEqual(expect.arrayContaining([
        { emoji: '👍', count: 2, mine: true },
        { emoji: '🔥', count: 1, mine: false },
      ]));
      expect(pourOuvrier.reactions).toEqual(expect.arrayContaining([
        { emoji: '👍', count: 2, mine: true },
        { emoji: '🔥', count: 1, mine: true },
      ]));
    });

    it('reagir deux fois du meme emoji retire la reaction', async () => {
      const message = (await poster(admin.token, {})).json();
      await reagir(admin.token, message.id, '❤️');

      const res = await reagir(admin.token, message.id, '❤️');

      expect(res.statusCode).toBe(200);
      expect(res.json().reactions).toEqual([]);
      expect((await lister())[0].reactions).toEqual([]);
    });

    it('refuse un emoji hors de la liste', async () => {
      const message = (await poster(admin.token, {})).json();

      expect((await reagir(admin.token, message.id, '🦄')).statusCode).toBe(400);
    });

    it("exige le droit de lire la discussion", async () => {
      const message = (await poster(admin.token, {})).json();

      expect((await reagir(sansDroit.token, message.id, '👍')).statusCode).toBe(403);
    });

    it('les reactions partent avec le message', async () => {
      const message = (await poster(admin.token, {})).json();
      await reagir(ouvrier.token, message.id, '👍');

      await app.inject({ method: 'DELETE', url: `/comments/${message.id}`, headers: auth(admin.token) });

      expect(await app.db('comment_reaction').where({ comment_id: message.id })).toHaveLength(0);
    });
  });

  describe('reagir : cloisonnement et reponse', () => {
    it("refuse de reagir a un message d'un chantier dont on n'est pas membre, sans rien enregistrer", async () => {
      const autre = (await app.inject({ method: 'POST', url: '/chantiers', headers: auth(admin.token), payload: { name: 'Autre' } })).json();
      const ailleurs = (await app.inject({ method: 'POST', url: '/comments', headers: auth(admin.token), payload: { chantier_id: autre.id, content: 'Secret' } })).json();

      const res = await reagir(ouvrier.token, ailleurs.id, '👍');

      expect([403, 404]).toContain(res.statusCode);
      expect(await app.db('comment_reaction').where({ comment_id: ailleurs.id })).toHaveLength(0);
    });

    it("refuse de reagir a un message d'une autre organisation", async () => {
      const beta = await createOrgWithAdmin(app, 'Beta TP');
      const leurChantier = (await app.inject({ method: 'POST', url: '/chantiers', headers: auth(beta.admin.token), payload: { name: 'Beta' } })).json();
      const leurMessage = (await app.inject({ method: 'POST', url: '/comments', headers: auth(beta.admin.token), payload: { chantier_id: leurChantier.id, content: 'Interne' } })).json();

      const res = await reagir(admin.token, leurMessage.id, '👍');

      expect([403, 404]).toContain(res.statusCode);
      expect(await app.db('comment_reaction').where({ comment_id: leurMessage.id })).toHaveLength(0);
    });

    it('renvoie 404 pour un message inexistant', async () => {
      expect((await reagir(admin.token, '00000000-0000-0000-0000-000000000000', '👍')).statusCode).toBe(404);
    });

    it("renvoie l'etat complet des reactions, vu par celui qui vient de reagir", async () => {
      // L'app remplace sa pastille optimiste par cette reponse : elle doit
      // compter les reactions des autres, pas seulement la sienne.
      const message = (await poster(admin.token, {})).json();
      await reagir(admin.token, message.id, '👍');
      await reagir(admin.token, message.id, '🔥');

      const res = await reagir(ouvrier.token, message.id, '👍');

      expect(res.statusCode).toBe(200);
      expect(res.json().comment_id).toBe(message.id);
      expect(res.json().reactions).toEqual(expect.arrayContaining([
        { emoji: '👍', count: 2, mine: true },
        { emoji: '🔥', count: 1, mine: false },
      ]));
      expect(res.json().reactions).toHaveLength(2);
    });

    it("previent en temps reel les autres participants, pas celui qui reagit", async () => {
      // On inscrit de fausses sockets dans le hub pour observer l'evenement.
      const recu = { admin: vi.fn(), ouvrier: vi.fn() };
      const sockets = {
        admin: { readyState: 1, send: recu.admin, close: vi.fn() } as unknown as WebSocket,
        ouvrier: { readyState: 1, send: recu.ouvrier, close: vi.fn() } as unknown as WebSocket,
      };
      addConnection(admin.id, sockets.admin, 'web');
      addConnection(ouvrier.id, sockets.ouvrier, 'mobile');
      try {
        const message = (await poster(admin.token, {})).json();
        recu.admin.mockClear();

        await reagir(ouvrier.token, message.id, '🙏');

        await vi.waitFor(() => {
          const evenements = recu.admin.mock.calls.map((c) => JSON.parse(String(c[0])));
          expect(evenements).toContainEqual({ type: 'comment.updated', chantier_id: chantierId, resource_id: message.id, actor_id: ouvrier.id });
        });
        const pourOuvrier = recu.ouvrier.mock.calls.map((c) => JSON.parse(String(c[0])));
        expect(pourOuvrier.filter((e) => e.type === 'comment.updated')).toHaveLength(0);
      } finally {
        removeConnection(admin.id, sockets.admin);
        removeConnection(ouvrier.id, sockets.ouvrier);
      }
    });
  });

  describe("fil general d'un chantier a etapes", () => {
    it("ne garde que les messages hors etape, avec leurs citations et leurs reactions", async () => {
      const etape = (await app.inject({ method: 'POST', url: '/chantier-steps', headers: auth(admin.token), payload: { chantier_id: chantierId, name: 'Fondations' } })).json();
      const general = (await poster(admin.token, { content: 'Reunion lundi' })).json();
      const surEtape = (await poster(admin.token, { content: 'Coffrage fini', step_id: etape.id })).json();
      await poster(ouvrier.token, { content: 'Je serai la', reply_to_id: general.id });
      await reagir(ouvrier.token, general.id, '👍');
      await reagir(ouvrier.token, surEtape.id, '🔥');

      const res = await app.inject({
        method: 'GET',
        url: `/comments?chantier_id=${chantierId}&step_id=general&order=asc`,
        headers: auth(admin.token),
      });

      expect(res.statusCode).toBe(200);
      const liste = res.json().data;
      expect(liste.map((c: { content: string }) => c.content)).toEqual(['Reunion lundi', 'Je serai la']);
      expect(liste[0].reactions).toEqual([{ emoji: '👍', count: 1, mine: false }]);
      expect(liste[1].reply_to).toMatchObject({ id: general.id, content: 'Reunion lundi' });

      const surLEtape = (await app.inject({
        method: 'GET',
        url: `/comments?chantier_id=${chantierId}&step_id=${etape.id}`,
        headers: auth(admin.token),
      })).json().data;
      expect(surLEtape.map((c: { content: string }) => c.content)).toEqual(['Coffrage fini']);
      expect(surLEtape[0].reactions).toEqual([{ emoji: '🔥', count: 1, mine: false }]);
    });
  });
});
