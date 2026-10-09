import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, auth } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import { createOrgWithAdmin, createUser, type TestUser } from '../helpers/factories';

/**
 * Reglages fins des notifications, mentions, et destinataires.
 *
 * Un seul interrupteur ne suffisait pas : sur plusieurs chantiers actifs, la
 * seule defense contre le bruit etait de tout couper, mentions et urgences
 * comprises. Et les notifications partaient a tous les membres d'un chantier,
 * y compris a ceux qui n'ont pas acces au contenu qu'elles citent.
 */
interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: { type?: string; comment_id?: string; step_id?: string; emergency_id?: string };
}

describe('Notifications : preferences, mentions, destinataires', () => {
  let app: FastifyInstance;
  let admin: TestUser;
  let ouvrier: TestUser;
  let client: TestUser;
  let gestionnaire: TestUser;
  let chantierId: string;
  let envois: PushMessage[];

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(app.db);
    const org = await createOrgWithAdmin(app, 'Alpha TP');
    admin = org.admin;
    ouvrier = await createUser(app, { organizationId: org.organizationId, role: 'employee' });
    client = await createUser(app, { organizationId: org.organizationId, role: 'client' });
    gestionnaire = await createUser(app, { organizationId: org.organizationId, role: 'gestionnaire_reseau' });
    await app.db('user').where({ id: ouvrier.id }).update({ first_name: 'Paul', last_name: 'Martin' });
    await app.db('user').where({ id: client.id }).update({ first_name: 'Claire', last_name: 'Durand' });

    const chantier = await app.inject({
      method: 'POST',
      url: '/chantiers',
      headers: auth(admin.token),
      payload: { name: 'Pont de la Loire' },
    });
    chantierId = chantier.json().id;

    // Les membres d'abord, les jetons ensuite : l'ajout au chantier envoie une
    // notification qui ne doit pas polluer ce que les tests observent.
    // Le seul role, comme le fait l'application : chacun recoit les droits de
    // son role — le gestionnaire reseau n'a pas acces aux discussions.
    for (const [membre, role] of [
      [ouvrier, 'ouvrier'],
      [client, 'client'],
      [gestionnaire, 'gestionnaire_reseau'],
    ] as const) {
      await app.inject({
        method: 'POST',
        url: '/chantier-members',
        headers: auth(admin.token),
        payload: { chantier_id: chantierId, user_id: membre.id, role },
      });
    }
    for (const compte of [admin, ouvrier, client, gestionnaire]) {
      await app.db('push_token').insert({ user_id: compte.id, token: `ExponentPushToken[${compte.id}]`, platform: 'ios' });
    }

    envois = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      envois.push(...(JSON.parse(String(init?.body ?? '[]')) as PushMessage[]));
      return { ok: true, json: async () => ({ data: [{ status: 'ok' }] }) } as unknown as Response;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const recu = (compte: TestUser, type: string) =>
    envois.find((m) => m.to === `ExponentPushToken[${compte.id}]` && m.data?.type === type);

  /** L'envoi est detache de la reponse HTTP : il faut lui laisser le temps. */
  const attendre = (compte: TestUser, type: string) =>
    vi.waitFor(() => expect(recu(compte, type)).toBeDefined(), { timeout: 3000 });

  /** Pour verifier une absence : un temoin qui doit, lui, recevoir. */
  const commenter = (auteur: TestUser, content: string) =>
    app.inject({ method: 'POST', url: '/comments', headers: auth(auteur.token), payload: { chantier_id: chantierId, content } });

  const mention = (compte: TestUser, nom: string) => `@[${nom}](${compte.id})`;

  describe('Preferences', () => {
    it('tout est actif par defaut', async () => {
      const res = await app.inject({ method: 'GET', url: '/notification-preferences', headers: auth(ouvrier.token) });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        push_enabled: true,
        categories: {
          messages: true,
          mentions: true,
          emergencies: true,
          steps: true,
          photos: true,
          documents: true,
          membership: true,
          reports: true,
        },
        chantiers: [],
      });
    });

    it('coupe une categorie sans toucher aux autres', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/notification-preferences',
        headers: auth(ouvrier.token),
        payload: { category: 'photos', enabled: false },
      });
      expect(res.json()).toEqual({ category: 'photos', enabled: false });

      const prefs = (await app.inject({ method: 'GET', url: '/notification-preferences', headers: auth(ouvrier.token) })).json();
      expect(prefs.categories.photos).toBe(false);
      expect(prefs.categories.messages).toBe(true);
    });

    it('refuse une categorie inconnue', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/notification-preferences',
        headers: auth(ouvrier.token),
        payload: { category: 'meteo', enabled: false },
      });
      expect(res.statusCode).toBe(400);
    });

    it('une categorie coupee ne sonne plus, les autres si', async () => {
      await app.inject({
        method: 'PATCH',
        url: '/notification-preferences',
        headers: auth(ouvrier.token),
        payload: { category: 'messages', enabled: false },
      });

      await commenter(admin, 'Le beton est coule');
      await attendre(client, 'comment');
      expect(recu(ouvrier, 'comment')).toBeUndefined();

      await app.inject({
        method: 'POST',
        url: '/photos',
        headers: auth(admin.token),
        payload: { chantier_id: chantierId, url: 'http://localhost:3000/files/photo-1.jpg' },
      });
      await attendre(ouvrier, 'photo');
    });
  });

  describe('Reglage par chantier', () => {
    const regler = (compte: TestUser, level: string, chantier = chantierId) =>
      app.inject({
        method: 'PUT',
        url: `/notification-preferences/chantiers/${chantier}`,
        headers: auth(compte.token),
        payload: { level },
      });

    it("« l'important » ne laisse passer que les mentions et les urgences", async () => {
      expect((await regler(ouvrier, 'important')).statusCode).toBe(200);

      await commenter(admin, 'Livraison demain');
      await attendre(client, 'comment');
      expect(recu(ouvrier, 'comment')).toBeUndefined();

      await commenter(admin, `${mention(ouvrier, 'Paul Martin')} tu peux verifier ?`);
      await attendre(ouvrier, 'mention');

      await app.inject({
        method: 'POST',
        url: '/emergencies',
        headers: auth(admin.token),
        payload: { chantier_id: chantierId, description: 'Fuite de gaz' },
      });
      await attendre(ouvrier, 'emergency');
    });

    it('« rien » coupe tout sur ce chantier, mentions comprises', async () => {
      await regler(ouvrier, 'none');

      await commenter(admin, `${mention(ouvrier, 'Paul Martin')} et ${mention(client, 'Claire Durand')}`);
      await attendre(client, 'mention');
      expect(recu(ouvrier, 'mention')).toBeUndefined();
      expect(recu(ouvrier, 'comment')).toBeUndefined();
    });

    it('apparait dans les preferences, et « tout » revient au defaut', async () => {
      await regler(ouvrier, 'none');
      let prefs = (await app.inject({ method: 'GET', url: '/notification-preferences', headers: auth(ouvrier.token) })).json();
      expect(prefs.chantiers).toEqual([{ chantier_id: chantierId, chantier_name: 'Pont de la Loire', level: 'none' }]);

      await regler(ouvrier, 'all');
      prefs = (await app.inject({ method: 'GET', url: '/notification-preferences', headers: auth(ouvrier.token) })).json();
      expect(prefs.chantiers).toEqual([]);
      const level = await app.inject({
        method: 'GET',
        url: `/notification-preferences/chantiers/${chantierId}`,
        headers: auth(ouvrier.token),
      });
      expect(level.json()).toEqual({ chantier_id: chantierId, level: 'all' });
    });

    it("refuse de regler un chantier dont on ne fait pas partie", async () => {
      const autre = await createOrgWithAdmin(app, 'Beta BTP');
      const res = await regler(autre.admin, 'none');
      expect(res.statusCode).toBe(404);
    });
  });

  describe('Destinataires', () => {
    it("ne previent pas d'un message celui qui n'a pas acces aux discussions", async () => {
      // Un gestionnaire reseau ne voit que les documents : il recevait pourtant
      // chaque message, texte compris, dans ses notifications.
      await commenter(admin, 'Le beton est coule');
      await attendre(client, 'comment');
      expect(recu(gestionnaire, 'comment')).toBeUndefined();
    });

    it("ne previent pas celui qui a bloque l'auteur", async () => {
      await app.inject({ method: 'POST', url: '/blocks', headers: auth(client.token), payload: { user_id: ouvrier.id } });

      await commenter(ouvrier, 'Je passe demain');
      await attendre(admin, 'comment');
      expect(recu(client, 'comment')).toBeUndefined();
    });
  });

  describe('Mentions', () => {
    it("previent la personne mentionnee, une seule fois, et les autres normalement", async () => {
      const res = await commenter(admin, `${mention(ouvrier, 'Paul Martin')} les plans sont arrives`);
      await attendre(ouvrier, 'mention');
      await attendre(client, 'comment');

      const notif = recu(ouvrier, 'mention');
      expect(notif?.title).toBe('@ Pont de la Loire');
      expect(notif?.body).toContain('vous a mentionné');
      expect(notif?.body).toContain('@Paul Martin les plans sont arrives');
      expect(notif?.data?.comment_id).toBe(res.json().id);
      // Pas de seconde alerte pour le meme message.
      expect(recu(ouvrier, 'comment')).toBeUndefined();
      // Les autres lisent le nom, pas la syntaxe.
      expect(recu(client, 'comment')?.body).toContain('@Paul Martin les plans');
    });

    it("ignore la mention de quelqu'un qui n'a pas acces a la discussion", async () => {
      await commenter(admin, `${mention(gestionnaire, 'Test gestionnaire_reseau')} regarde`);
      await attendre(client, 'comment');
      expect(recu(gestionnaire, 'mention')).toBeUndefined();
    });

    it("passe meme quand les messages ordinaires sont coupes", async () => {
      await app.inject({
        method: 'PATCH',
        url: '/notification-preferences',
        headers: auth(ouvrier.token),
        payload: { category: 'messages', enabled: false },
      });
      await commenter(admin, `${mention(ouvrier, 'Paul Martin')} urgent`);
      await attendre(ouvrier, 'mention');
    });

    it('une modification ne previent que les nouvelles personnes mentionnees', async () => {
      const cree = await commenter(admin, `${mention(ouvrier, 'Paul Martin')} les plans`);
      await attendre(ouvrier, 'mention');
      await attendre(client, 'comment');
      envois.length = 0;

      await app.inject({
        method: 'PATCH',
        url: `/comments/${cree.json().id}`,
        headers: auth(admin.token),
        payload: { content: `${mention(ouvrier, 'Paul Martin')} ${mention(client, 'Claire Durand')} les plans` },
      });
      await attendre(client, 'mention');
      expect(recu(ouvrier, 'mention')).toBeUndefined();
      expect(envois.some((m) => m.data?.type === 'comment')).toBe(false);
    });

    it("fonctionne dans le fil d'une urgence, et dit ou l'ouvrir", async () => {
      const urgence = await app.inject({
        method: 'POST',
        url: '/emergencies',
        headers: auth(admin.token),
        payload: { chantier_id: chantierId, description: 'Fuite de gaz' },
      });
      const emergencyId = urgence.json().id;

      await app.inject({
        method: 'POST',
        url: '/emergency-comments',
        headers: auth(admin.token),
        payload: { emergency_id: emergencyId, content: `${mention(gestionnaire, 'Test gestionnaire_reseau')} coupez le reseau` },
      });
      // Le fil d'une urgence est ouvert a tous les participants du chantier.
      await attendre(gestionnaire, 'mention');
      expect(recu(gestionnaire, 'mention')?.data?.emergency_id).toBe(emergencyId);
    });
  });

  describe('Personnes mentionnables', () => {
    const lister = (compte: TestUser, thread?: string) =>
      app.inject({
        method: 'GET',
        url: `/chantier-members/mentionable?chantier_id=${chantierId}${thread ? `&thread=${thread}` : ''}`,
        headers: auth(compte.token),
      });

    it('liste ceux qui lisent la discussion, sans soi-meme ni coordonnees', async () => {
      const res = await lister(ouvrier);

      expect(res.statusCode).toBe(200);
      const ids = res.json().map((u: { id: string }) => u.id);
      expect(ids).toEqual(expect.arrayContaining([admin.id, client.id]));
      expect(ids).not.toContain(ouvrier.id);
      expect(ids).not.toContain(gestionnaire.id);
      expect(Object.keys(res.json()[0]).sort()).toEqual(['first_name', 'id', 'last_name']);
    });

    it("reste ouvert a qui n'a pas acces a l'equipe", async () => {
      await app.db('chantier_member').where({ chantier_id: chantierId, user_id: client.id }).update({ can_view_team: false });
      const res = await lister(client);
      expect(res.statusCode).toBe(200);
      expect(res.json().map((u: { id: string }) => u.id)).toContain(ouvrier.id);
    });

    it("est refuse a qui ne lit pas la discussion", async () => {
      expect((await lister(gestionnaire)).statusCode).toBe(403);
    });

    it("dans le fil d'une urgence, inclut tous les participants", async () => {
      const res = await lister(ouvrier, 'emergency');
      expect(res.json().map((u: { id: string }) => u.id)).toContain(gestionnaire.id);
    });
  });
});
