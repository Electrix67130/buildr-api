import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, auth } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import { createOrgWithAdmin, createUser, createSuperAdmin, type TestUser } from '../helpers/factories';

/**
 * Signalements : bugs et suggestions.
 *
 * Deux publics pour une meme entite. Tout le monde peut ecrire et relire ses
 * propres messages ; seul un super admin lit ceux des autres et y repond. La
 * frontiere entre les deux est ce qui compte ici : un signalement contient
 * souvent une adresse, une capture d'ecran mentale du chantier, parfois un
 * reproche sur un collegue.
 */
describe('Signalements', () => {
  let app: FastifyInstance;
  let organizationId: string;
  let admin: TestUser;
  let ouvrier: TestUser;
  let superAdmin: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(app.db);
    const org = await createOrgWithAdmin(app, 'Alpha TP');
    organizationId = org.organizationId;
    admin = org.admin;
    ouvrier = await createUser(app, { organizationId, role: 'employee', locale: 'de' });
    superAdmin = await createSuperAdmin(app, organizationId);
  });

  const bug = {
    type: 'bug',
    subject: 'La galerie photos reste vide',
    message: "Sur le chantier du pont, les photos que j'envoie n'apparaissent pas dans la galerie.",
  };

  const deposer = (token: string, payload: Record<string, unknown> = {}) =>
    app.inject({ method: 'POST', url: '/feedbacks', headers: auth(token), payload: { ...bug, ...payload } });

  describe('depot', () => {
    it('enregistre un bug avec son auteur et son organisation', async () => {
      const res = await deposer(ouvrier.token);

      expect(res.statusCode).toBe(201);
      const row = await app.db('feedback').where({ id: res.json().id }).first();
      expect(row.user_id).toBe(ouvrier.id);
      expect(row.organization_id).toBe(organizationId);
      expect(row.type).toBe('bug');
      expect(row.status).toBe('new');
      expect(row.response).toBeNull();
    });

    it('enregistre une suggestion', async () => {
      const res = await deposer(ouvrier.token, {
        type: 'suggestion',
        subject: 'Pouvoir dupliquer un modele de chantier',
        message: 'Ce serait pratique de dupliquer un modele existant au lieu de tout ressaisir.',
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().type).toBe('suggestion');
    });

    it('retient le contexte technique fourni par le client', async () => {
      // Sans lui, un bug mobile est irreproductible.
      const res = await deposer(ouvrier.token, { platform: 'mobile', app_version: '1.4.0', screen: 'chantier/photos' });

      const row = await app.db('feedback').where({ id: res.json().id }).first();
      expect(row.platform).toBe('mobile');
      expect(row.app_version).toBe('1.4.0');
      expect(row.screen).toBe('chantier/photos');
    });

    it("retient la langue du message pour qu'on y reponde dans la bonne", async () => {
      const explicite = await deposer(ouvrier.token, { locale: 'pl' });
      expect((await app.db('feedback').where({ id: explicite.json().id }).first()).locale).toBe('pl');

      // A defaut, celle du compte.
      const implicite = await deposer(ouvrier.token);
      expect((await app.db('feedback').where({ id: implicite.json().id }).first()).locale).toBe('de');
    });

    it('refuse un signalement vide ou bacle', async () => {
      expect((await deposer(ouvrier.token, { message: 'bug' })).statusCode).toBe(400);
      expect((await deposer(ouvrier.token, { message: '   ' })).statusCode).toBe(400);
      expect((await deposer(ouvrier.token, { subject: 'ok' })).statusCode).toBe(400);
      expect((await deposer(ouvrier.token, { type: 'reclamation' })).statusCode).toBe(400);
    });

    it('refuse un depot anonyme', async () => {
      const res = await app.inject({ method: 'POST', url: '/feedbacks', payload: bug });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('relecture par son auteur', () => {
    it('ne montre a chacun que ses propres signalements', async () => {
      await deposer(ouvrier.token);
      await deposer(admin.token, { subject: 'Autre chose', message: 'Un message qui appartient a quelqu un d autre.' });

      const res = await app.inject({ method: 'GET', url: '/feedbacks/mine', headers: auth(ouvrier.token) });

      expect(res.statusCode).toBe(200);
      expect(res.json().data).toHaveLength(1);
      expect(res.json().data[0].subject).toBe(bug.subject);
    });

    it("traite le signalement d'autrui comme inexistant", async () => {
      const autre = await deposer(admin.token);

      const res = await app.inject({
        method: 'GET',
        url: `/feedbacks/mine/${autre.json().id}`,
        headers: auth(ouvrier.token),
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('console support', () => {
    it("n'est pas accessible a un administrateur d'organisation", async () => {
      // Un signalement peut parler d'un collegue ou d'un client : il ne remonte
      // pas la hierarchie de l'entreprise, il va au support.
      expect((await app.inject({ method: 'GET', url: '/super-admin/feedbacks', headers: auth(admin.token) })).statusCode).toBe(403);
      expect((await app.inject({ method: 'GET', url: '/super-admin/feedbacks', headers: auth(ouvrier.token) })).statusCode).toBe(403);
    });

    it('montre au super admin les signalements de tout le monde', async () => {
      await deposer(ouvrier.token);
      await deposer(admin.token, { subject: 'Un deuxieme', message: 'Un second signalement, par quelqu un d autre.' });

      const res = await app.inject({ method: 'GET', url: '/super-admin/feedbacks', headers: auth(superAdmin.token) });

      expect(res.statusCode).toBe(200);
      expect(res.json().data).toHaveLength(2);
    });

    it("joint l'auteur et son organisation, pour savoir a qui on parle", async () => {
      await deposer(ouvrier.token);

      const res = await app.inject({ method: 'GET', url: '/super-admin/feedbacks', headers: auth(superAdmin.token) });

      expect(res.json().data[0]).toMatchObject({
        author_email: ouvrier.email,
        organization_name: 'Alpha TP',
      });
    });

    it('place les signalements non traites en tete', async () => {
      // Une console de support se lit par ce qui reste a faire, pas par date.
      const ancien = await deposer(ouvrier.token, { subject: 'Ancien, deja traite' });
      await app.inject({
        method: 'PATCH',
        url: `/super-admin/feedbacks/${ancien.json().id}`,
        headers: auth(superAdmin.token),
        payload: { status: 'resolved' },
      });
      const nouveau = await deposer(ouvrier.token, { subject: 'Nouveau, a traiter' });

      const res = await app.inject({ method: 'GET', url: '/super-admin/feedbacks', headers: auth(superAdmin.token) });

      expect(res.json().data[0].id).toBe(nouveau.json().id);
    });

    it('filtre par statut et par nature', async () => {
      await deposer(ouvrier.token);
      const suggestion = await deposer(ouvrier.token, {
        type: 'suggestion',
        subject: 'Dupliquer un modele',
        message: 'Ce serait pratique de dupliquer un modele existant.',
      });

      const bugs = await app.inject({
        method: 'GET',
        url: '/super-admin/feedbacks?type=bug',
        headers: auth(superAdmin.token),
      });
      expect(bugs.json().data).toHaveLength(1);
      expect(bugs.json().data[0].type).toBe('bug');

      const nouveaux = await app.inject({
        method: 'GET',
        url: '/super-admin/feedbacks?status=new',
        headers: auth(superAdmin.token),
      });
      expect(nouveaux.json().data).toHaveLength(2);

      expect(suggestion.statusCode).toBe(201);
    });

    it("cherche dans le sujet, le message et l'adresse de l'auteur", async () => {
      await deposer(ouvrier.token);

      const parSujet = await app.inject({
        method: 'GET',
        url: '/super-admin/feedbacks?q=galerie',
        headers: auth(superAdmin.token),
      });
      const parMessage = await app.inject({
        method: 'GET',
        url: '/super-admin/feedbacks?q=pont',
        headers: auth(superAdmin.token),
      });
      const parAuteur = await app.inject({
        method: 'GET',
        url: `/super-admin/feedbacks?q=${encodeURIComponent(ouvrier.email)}`,
        headers: auth(superAdmin.token),
      });
      const sansResultat = await app.inject({
        method: 'GET',
        url: '/super-admin/feedbacks?q=zzzintrouvable',
        headers: auth(superAdmin.token),
      });

      expect(parSujet.json().data).toHaveLength(1);
      expect(parMessage.json().data).toHaveLength(1);
      expect(parAuteur.json().data).toHaveLength(1);
      expect(sansResultat.json().data).toHaveLength(0);
    });

    it('compte les signalements par statut', async () => {
      await deposer(ouvrier.token);

      const res = await app.inject({ method: 'GET', url: '/super-admin/feedbacks', headers: auth(superAdmin.token) });

      expect(res.json().counts.new).toBe(1);
    });
  });

  describe('reponse du support', () => {
    let feedbackId: string;

    beforeEach(async () => {
      feedbackId = (await deposer(ouvrier.token)).json().id;
    });

    const repondre = (token: string, payload: Record<string, unknown>) =>
      app.inject({ method: 'PATCH', url: `/super-admin/feedbacks/${feedbackId}`, headers: auth(token), payload });

    it("n'est pas ouverte a un administrateur d'organisation", async () => {
      expect((await repondre(admin.token, { response: 'Bonjour' })).statusCode).toBe(403);
      const row = await app.db('feedback').where({ id: feedbackId }).first();
      expect(row.response).toBeNull();
    });

    it('enregistre la reponse, son auteur et sa date', async () => {
      const res = await repondre(superAdmin.token, { response: 'Corrige dans la version 1.4.1, merci du signalement.' });

      expect(res.statusCode).toBe(200);
      const row = await app.db('feedback').where({ id: feedbackId }).first();
      expect(row.response).toContain('1.4.1');
      expect(row.responded_by).toBe(superAdmin.id);
      expect(row.responded_at).toBeTruthy();
    });

    it('considere que repondre, c est traiter', async () => {
      await repondre(superAdmin.token, { response: 'Corrige.' });

      expect((await app.db('feedback').where({ id: feedbackId }).first()).status).toBe('resolved');
    });

    it('laisse le support forcer un autre statut en repondant', async () => {
      await repondre(superAdmin.token, { response: 'On regarde.', status: 'in_progress' });

      expect((await app.db('feedback').where({ id: feedbackId }).first()).status).toBe('in_progress');
    });

    it('permet de classer sans repondre', async () => {
      await repondre(superAdmin.token, { status: 'declined' });

      const row = await app.db('feedback').where({ id: feedbackId }).first();
      expect(row.status).toBe('declined');
      expect(row.response).toBeNull();
      expect(row.responded_by).toBeNull();
    });

    it('efface le repondant quand on retire la reponse', async () => {
      await repondre(superAdmin.token, { response: 'Erreur de ma part.' });
      await repondre(superAdmin.token, { response: null });

      const row = await app.db('feedback').where({ id: feedbackId }).first();
      expect(row.response).toBeNull();
      expect(row.responded_by).toBeNull();
      expect(row.responded_at).toBeNull();
    });

    it('refuse une requete qui ne dit rien', async () => {
      expect((await repondre(superAdmin.token, {})).statusCode).toBe(400);
    });

    it("laisse l'auteur lire la reponse recue", async () => {
      await repondre(superAdmin.token, { response: 'Corrige dans la version 1.4.1.' });

      const res = await app.inject({
        method: 'GET',
        url: `/feedbacks/mine/${feedbackId}`,
        headers: auth(ouvrier.token),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().response).toContain('1.4.1');
      expect(res.json().status).toBe('resolved');
    });

    it("laisse une trace d'audit attribuable", async () => {
      // Ecrire a un utilisateur au nom du produit ne doit pas etre anonyme.
      await repondre(superAdmin.token, { response: 'Corrige.' });

      const trace = await app.db('audit_log').where({ action: 'feedback.respond', target_id: feedbackId }).first();
      expect(trace).toBeTruthy();
      expect(trace.super_admin_id).toBe(superAdmin.id);
    });

    it('renvoie 404 pour un signalement inexistant', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/super-admin/feedbacks/00000000-0000-0000-0000-000000000000',
        headers: auth(superAdmin.token),
        payload: { status: 'resolved' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("notification a l'auteur", () => {
    let feedbackId: string;
    let envois: { url: string; messages: { to: string; title: string; body: string; data: unknown }[] }[];

    beforeEach(async () => {
      feedbackId = (await deposer(ouvrier.token)).json().id;
      await app.db('push_token').insert({ user_id: ouvrier.id, token: 'ExponentPushToken[ouvrier]', platform: 'ios' });

      // On intercepte l'appel a Expo : aucun test ne doit sortir sur le reseau,
      // et c'est le seul moyen d'observer un envoi declenche en arriere-plan.
      envois = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
        envois.push({ url: String(url), messages: JSON.parse(String(init?.body ?? '[]')) });
        return { ok: true, json: async () => ({ data: [{ status: 'ok' }] }) } as unknown as Response;
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    const repondre = (token: string, payload: Record<string, unknown>) =>
      app.inject({ method: 'PATCH', url: `/super-admin/feedbacks/${feedbackId}`, headers: auth(token), payload });

    /** L'envoi est detache de la reponse HTTP : il faut lui laisser le temps. */
    const attendreEnvoi = () => vi.waitFor(() => expect(envois.length).toBeGreaterThan(0), { timeout: 3000 });

    it("previent l'auteur quand le support lui repond", async () => {
      await repondre(superAdmin.token, { response: 'Corrige dans la version 1.4.1.' });
      await attendreEnvoi();

      expect(envois[0].url).toContain('exp.host');
      const message = envois[0].messages[0];
      expect(message.to).toBe('ExponentPushToken[ouvrier]');
      expect(message.body).toContain('galerie photos');
      expect(message.data).toMatchObject({ type: 'feedback', feedback_id: feedbackId });
    });

    it("ecrit la notification dans la langue du signalement", async () => {
      // L'ouvrier de ce jeu de test a le compte en allemand, donc le
      // signalement aussi.
      await repondre(superAdmin.token, { response: 'Behoben in Version 1.4.1.' });
      await attendreEnvoi();

      expect(envois[0].messages[0].title).toContain('Antwort auf Ihre Meldung');
    });

    it("ne derange personne pour un simple changement de statut", async () => {
      // Classer un signalement n'est pas une nouvelle a annoncer.
      await repondre(superAdmin.token, { status: 'in_progress' });
      await new Promise((r) => setTimeout(r, 300));

      expect(envois).toHaveLength(0);
    });

    it("ne renotifie pas quand la reponse est reenregistree a l'identique", async () => {
      await repondre(superAdmin.token, { response: 'Corrige.' });
      await attendreEnvoi();

      await repondre(superAdmin.token, { response: 'Corrige.', status: 'resolved' });
      await new Promise((r) => setTimeout(r, 300));

      expect(envois).toHaveLength(1);
    });

    it("respecte le refus des notifications", async () => {
      await app.db('user').where({ id: ouvrier.id }).update({ push_enabled: false });

      await repondre(superAdmin.token, { response: 'Corrige.' });
      await new Promise((r) => setTimeout(r, 300));

      expect(envois).toHaveLength(0);
    });

    it("ne se notifie pas soi-meme", async () => {
      const sien = (await deposer(superAdmin.token, { subject: 'Signalement du support lui-meme' })).json().id;
      await app.db('push_token').insert({ user_id: superAdmin.id, token: 'ExponentPushToken[support]', platform: 'ios' });

      await app.inject({
        method: 'PATCH',
        url: `/super-admin/feedbacks/${sien}`,
        headers: auth(superAdmin.token),
        payload: { response: 'Note pour moi-meme.' },
      });
      await new Promise((r) => setTimeout(r, 300));

      expect(envois).toHaveLength(0);
    });

    it("n'empeche pas la reponse d'etre enregistree si l'envoi echoue", async () => {
      // Expo indisponible ne doit pas faire perdre une reponse deja ecrite.
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Expo injoignable'));

      const res = await repondre(superAdmin.token, { response: 'Corrige malgre tout.' });

      expect(res.statusCode).toBe(200);
      expect((await app.db('feedback').where({ id: feedbackId }).first()).response).toBe('Corrige malgre tout.');
    });
  });

  describe('suppression de compte', () => {
    it("efface les signalements de qui supprime son compte", async () => {
      // La suppression de compte promet l'effacement des donnees : un
      // signalement est du contenu ecrit par la personne.
      const id = (await deposer(ouvrier.token)).json().id;

      await app.db('user').where({ id: ouvrier.id }).del();

      expect(await app.db('feedback').where({ id }).first()).toBeUndefined();
    });
  });
});
