import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, auth } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import { createOrgWithAdmin, createUser, createSuperAdmin, type TestUser } from '../helpers/factories';

/**
 * Signalements : un message, une photo ou un membre remonte a l'administrateur
 * de l'organisation, jamais a la personne visee, et a la console quand c'est
 * un administrateur qui est vise.
 */
describe('Signalements', () => {
  let app: FastifyInstance;
  let organizationId: string;
  let admin: TestUser;
  let admin2: TestUser;
  let ouvrier: TestUser;
  let autre: TestUser;
  let chantierId: string;
  let messageId: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const signaler = (token: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/reports', headers: auth(token), payload: { reason: 'inappropriate', ...payload } });
  const lister = (token: string, query = '') =>
    app.inject({ method: 'GET', url: `/reports${query}`, headers: auth(token) });

  beforeEach(async () => {
    await truncateAll(app.db);
    const org = await createOrgWithAdmin(app, 'Alpha TP');
    organizationId = org.organizationId;
    admin = org.admin;
    admin2 = await createUser(app, { organizationId, role: 'admin' });
    ouvrier = await createUser(app, { organizationId, role: 'employee' });
    autre = await createUser(app, { organizationId, role: 'employee' });
    chantierId = (await app.inject({ method: 'POST', url: '/chantiers', headers: auth(admin.token), payload: { name: 'Pont' } })).json().id;
    for (const u of [ouvrier, autre]) {
      await app.inject({ method: 'POST', url: '/chantier-members', headers: auth(admin.token), payload: { chantier_id: chantierId, user_id: u.id, role: 'ouvrier' } });
    }
    messageId = (await app.inject({ method: 'POST', url: '/comments', headers: auth(ouvrier.token), payload: { chantier_id: chantierId, content: 'Message deplace' } })).json().id;
  });

  describe('deposer un signalement', () => {
    it("un message : l'admin le voit avec l'extrait, l'auteur vise et le chantier", async () => {
      const res = await signaler(autre.token, { target_type: 'comment', target_id: messageId, comment: 'Pas sa place ici' });

      expect(res.statusCode).toBe(201);
      const liste = (await lister(admin.token)).json();
      expect(liste.counts.pending).toBe(1);
      expect(liste.data[0]).toMatchObject({
        target_type: 'comment',
        target_excerpt: 'Message deplace',
        target_user_id: ouvrier.id,
        chantier_id: chantierId,
        reporter_first_name: expect.any(String),
        target_exists: true,
        escalated: false,
      });
    });

    it('un membre : partage une organisation avec lui, sans chantier', async () => {
      const res = await signaler(autre.token, { target_type: 'user', target_id: ouvrier.id, reason: 'harassment' });

      expect(res.statusCode).toBe(201);
      expect(res.json().chantier_id).toBeNull();
      expect(res.json().organization_id).toBe(organizationId);
    });

    it('une photo : par un participant du chantier', async () => {
      const photo = (await app.inject({ method: 'POST', url: '/photos', headers: auth(admin.token), payload: { chantier_id: chantierId, url: 'http://localhost:3000/files/p.jpg', caption: 'Photo douteuse' } })).json();

      const res = await signaler(ouvrier.token, { target_type: 'photo', target_id: photo.id });

      expect(res.statusCode).toBe(201);
      expect(res.json().target_user_id).toBe(admin.id);
      expect(res.json().target_excerpt).toBe('Photo douteuse');
    });

    it("une photo d'urgence : par un participant du chantier, rattachee au chantier", async () => {
      // Les photos d'une urgence ne sont pas dans la galerie, mais elles
      // restent des photos : on doit pouvoir les signaler depuis l'urgence.
      const urgence = (await app.inject({
        method: 'POST',
        url: '/emergencies',
        headers: auth(ouvrier.token),
        payload: { chantier_id: chantierId, description: 'Fuite', photos: [{ url: 'http://localhost:3000/files/u.jpg' }] },
      })).json();
      const photoId = urgence.photos[0].id as string;

      const res = await signaler(autre.token, { target_type: 'photo', target_id: photoId, reason: 'off_topic' });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ target_type: 'photo', target_id: photoId, target_user_id: ouvrier.id, chantier_id: chantierId });
      const liste = (await lister(admin.token)).json().data;
      expect(liste.map((r: { target_id: string }) => r.target_id)).toContain(photoId);
    });

    it("une photo d'urgence d'un chantier dont on n'est pas participant n'est pas confirmee", async () => {
      const autreChantier = (await app.inject({ method: 'POST', url: '/chantiers', headers: auth(admin.token), payload: { name: 'Autre' } })).json().id;
      const urgence = (await app.inject({
        method: 'POST',
        url: '/emergencies',
        headers: auth(admin.token),
        payload: { chantier_id: autreChantier, photos: [{ url: 'http://localhost:3000/files/v.jpg' }] },
      })).json();

      const res = await signaler(ouvrier.token, { target_type: 'photo', target_id: urgence.photos[0].id });

      expect(res.statusCode).toBe(404);
    });

    it("refuse de se signaler soi-meme", async () => {
      expect((await signaler(ouvrier.token, { target_type: 'comment', target_id: messageId })).statusCode).toBe(400);
    });

    it("ne confirme pas l'existence d'un message hors de ses chantiers", async () => {
      const etranger = await createUser(app, { organizationId, role: 'employee' });
      expect((await signaler(etranger.token, { target_type: 'comment', target_id: messageId })).statusCode).toBe(404);
    });

    it('ne cree pas de doublon tant que le premier est en attente', async () => {
      const premier = (await signaler(autre.token, { target_type: 'comment', target_id: messageId })).json();
      const second = await signaler(autre.token, { target_type: 'comment', target_id: messageId });

      expect(second.statusCode).toBe(200);
      expect(second.json().id).toBe(premier.id);
      expect((await lister(admin.token)).json().counts.pending).toBe(1);
    });
  });

  describe('qui voit quoi', () => {
    it("la personne visee ne voit pas le signalement qui la concerne, meme administratrice", async () => {
      await signaler(ouvrier.token, { target_type: 'user', target_id: admin.id });

      expect((await lister(admin.token)).json().data).toHaveLength(0);
      expect((await lister(admin2.token)).json().data).toHaveLength(1);
    });

    it("un signalement contre un administrateur remonte a la console", async () => {
      const superAdmin = await createSuperAdmin(app, organizationId);
      const res = (await signaler(ouvrier.token, { target_type: 'user', target_id: admin.id })).json();
      expect(res.escalated).toBe(true);

      const console_ = await app.inject({ method: 'GET', url: '/super-admin/reports?escalated=1', headers: auth(superAdmin.token) });

      expect(console_.statusCode).toBe(200);
      expect(console_.json().data.map((r: { id: string }) => r.id)).toEqual([res.id]);
      expect(console_.json().data[0].organization_name).toBe('Alpha TP');
    });

    it("un simple membre ne liste pas les signalements", async () => {
      expect((await lister(ouvrier.token)).statusCode).toBe(403);
    });

    it("l'admin d'une autre organisation ne voit rien", async () => {
      await signaler(autre.token, { target_type: 'comment', target_id: messageId });
      const beta = await createOrgWithAdmin(app, 'Beta BTP');

      expect((await lister(beta.admin.token)).json().data).toHaveLength(0);
    });
  });

  describe('traiter', () => {
    it("l'admin traite, et le signalement survit a la suppression du message", async () => {
      const report = (await signaler(autre.token, { target_type: 'comment', target_id: messageId })).json();
      await app.inject({ method: 'DELETE', url: `/comments/${messageId}`, headers: auth(admin.token) });

      const res = await app.inject({ method: 'PATCH', url: `/reports/${report.id}`, headers: auth(admin.token), payload: { status: 'resolved', resolution_note: 'Message supprime' } });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: 'resolved', resolved_by: admin.id, resolution_note: 'Message supprime' });
      const liste = (await lister(admin.token, '?status=resolved')).json();
      expect(liste.data[0].target_exists).toBe(false);
      expect(liste.data[0].target_excerpt).toBe('Message deplace');
      expect(liste.counts.pending).toBe(0);
    });

    it("la personne visee ne peut pas classer son propre signalement", async () => {
      const report = (await signaler(ouvrier.token, { target_type: 'user', target_id: admin.id })).json();

      const res = await app.inject({ method: 'PATCH', url: `/reports/${report.id}`, headers: auth(admin.token), payload: { status: 'dismissed' } });

      expect(res.statusCode).toBe(404);
      expect((await app.db('report').where({ id: report.id }).first()).status).toBe('pending');
    });

    it('un simple membre ne traite rien', async () => {
      const report = (await signaler(autre.token, { target_type: 'comment', target_id: messageId })).json();
      expect((await app.inject({ method: 'PATCH', url: `/reports/${report.id}`, headers: auth(ouvrier.token), payload: { status: 'dismissed' } })).statusCode).toBe(404);
    });
  });
});
