import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, auth } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import { createOrgWithAdmin, createUser, type TestUser } from '../helpers/factories';

/**
 * Urgences et reclamations, et la gestion des membres d'un chantier.
 *
 * Une urgence est declaree sur place, souvent avec une photo et une position :
 * un incident, un danger, une degradation. Elle porte donc ce qu'un chantier a
 * de plus sensible, et son fil de discussion avec.
 */
describe('Urgences et membres de chantier', () => {
  let app: FastifyInstance;
  let organizationId: string;
  let admin: TestUser;
  let ouvrier: TestUser;
  let chantierId: string;
  let emergencyId: string;
  let beta: { organizationId: string; admin: TestUser };

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
    ouvrier = await createUser(app, { organizationId, role: 'employee' });

    const chantier = await app.inject({
      method: 'POST',
      url: '/chantiers',
      headers: auth(admin.token),
      payload: { name: 'Pont de la Loire' },
    });
    chantierId = chantier.json().id;

    await app.inject({
      method: 'POST',
      url: '/chantier-members',
      headers: auth(admin.token),
      payload: { chantier_id: chantierId, user_id: ouvrier.id, role: 'ouvrier' },
    });

    const urgence = await app.inject({
      method: 'POST',
      url: '/emergencies',
      headers: auth(ouvrier.token),
      payload: { chantier_id: chantierId, description: 'Effondrement partiel de la tranchee' },
    });
    expect(urgence.statusCode).toBe(201);
    emergencyId = urgence.json().id;

    beta = await createOrgWithAdmin(app, 'Beta Constructions');
  });

  describe('declaration', () => {
    it("l'ouvrier present sur le chantier declare une urgence", async () => {
      const row = await app.db('chantier_emergency').where({ id: emergencyId }).first();
      expect(row.chantier_id).toBe(chantierId);
      expect(row.description).toContain('Effondrement');
    });

    it("quelqu'un qui n'est pas sur le chantier n'en declare pas", async () => {
      const etranger = await createUser(app, { organizationId, role: 'employee' });

      const res = await app.inject({
        method: 'POST',
        url: '/emergencies',
        headers: auth(etranger.token),
        payload: { chantier_id: chantierId, description: 'Fausse alerte' },
      });

      expect(res.statusCode).toBe(403);
    });

    it("l'administrateur voit l'urgence de son chantier", async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/emergencies?chantier_id=${chantierId}`,
        headers: auth(admin.token),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data).toHaveLength(1);
    });
  });

  describe('fil de discussion', () => {
    it("un membre du chantier y repond", async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/emergency-comments',
        headers: auth(admin.token),
        payload: { emergency_id: emergencyId, content: 'Equipe envoyee sur place' },
      });

      expect(res.statusCode).toBe(201);
    });

    it("un collegue qui n'est pas sur le chantier ne lit pas le fil", async () => {
      // Plus subtil que l'organisation etrangere : il a un compte legitime dans
      // l'entreprise, mais une urgence met parfois en cause quelqu'un.
      const etranger = await createUser(app, { organizationId, role: 'employee' });

      const res = await app.inject({
        method: 'GET',
        url: `/emergency-comments?emergency_id=${emergencyId}`,
        headers: auth(etranger.token),
      });

      expect(res.statusCode).toBe(404);
    });

    it("un collegue qui n'est pas sur le chantier n'y ecrit pas", async () => {
      const etranger = await createUser(app, { organizationId, role: 'employee' });

      const res = await app.inject({
        method: 'POST',
        url: '/emergency-comments',
        headers: auth(etranger.token),
        payload: { emergency_id: emergencyId, content: 'Message d un tiers' },
      });

      expect(res.statusCode).toBe(404);
      expect(await app.db('emergency_comment').count('* as n').first()).toMatchObject({ n: '0' });
    });

    it("l'administrateur d'une autre organisation ne supprime pas un message", async () => {
      const message = await app.inject({
        method: 'POST',
        url: '/emergency-comments',
        headers: auth(ouvrier.token),
        payload: { emergency_id: emergencyId, content: 'Photos de l incident' },
      });
      expect(message.statusCode).toBe(201);

      const res = await app.inject({
        method: 'DELETE',
        url: `/emergency-comments/${message.json().id}`,
        headers: auth(beta.admin.token),
      });

      expect(res.statusCode).toBe(403);
      expect(await app.db('emergency_comment').where({ id: message.json().id }).first()).toBeTruthy();
    });

    it("quelqu'un d'une autre organisation n'y repond pas", async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/emergency-comments',
        headers: auth(beta.admin.token),
        payload: { emergency_id: emergencyId, content: 'Message intrus' },
      });

      expect(res.statusCode).not.toBe(201);
    });
  });

  describe('cloisonnement entre organisations', () => {
    it("les urgences d'une autre organisation ne sont pas lisibles", async () => {
      // Une urgence decrit un incident : sa lecture par une entreprise
      // concurrente est une fuite, et un risque pour le client.
      const res = await app.inject({
        method: 'GET',
        url: `/emergencies?chantier_id=${chantierId}`,
        headers: auth(beta.admin.token),
      });

      expect(res.statusCode).not.toBe(200);
      expect(res.body).not.toContain('Effondrement');
    });

    it("on ne declare pas d'urgence sur le chantier d'une autre organisation", async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/emergencies',
        headers: auth(beta.admin.token),
        payload: { chantier_id: chantierId, description: 'Urgence inventee' },
      });

      expect(res.statusCode).toBe(403);
    });

    it("on ne supprime pas l'urgence d'une autre organisation", async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/emergencies/${emergencyId}`,
        headers: auth(beta.admin.token),
      });

      expect(res.statusCode).not.toBe(204);
      expect(await app.db('chantier_emergency').where({ id: emergencyId }).first()).toBeTruthy();
    });
  });

  describe('membres du chantier', () => {
    it("l'equipe d'un chantier d'une autre organisation n'est pas modifiable", async () => {
      // Retirer un ouvrier du chantier d'une entreprise concurrente lui coupe
      // l'acces a son propre travail.
      const lien = await app.db('chantier_member').where({ chantier_id: chantierId, user_id: ouvrier.id }).first();

      const res = await app.inject({
        method: 'DELETE',
        url: `/chantier-members/${lien.id}`,
        headers: auth(beta.admin.token),
      });

      expect(res.statusCode).not.toBe(204);
      expect(await app.db('chantier_member').where({ id: lien.id }).first()).toBeTruthy();
    });

    it("les droits d'un membre d'une autre organisation ne sont pas modifiables", async () => {
      const lien = await app.db('chantier_member').where({ chantier_id: chantierId, user_id: ouvrier.id }).first();

      const res = await app.inject({
        method: 'PATCH',
        url: `/chantier-members/${lien.id}`,
        headers: auth(beta.admin.token),
        payload: { can_edit: true },
      });

      expect(res.statusCode).not.toBe(200);
      expect((await app.db('chantier_member').where({ id: lien.id }).first()).can_edit).toBe(false);
    });

    it("on n'ajoute personne au chantier d'une autre organisation", async () => {
      const complice = await createUser(app, { organizationId: beta.organizationId, role: 'employee' });

      const res = await app.inject({
        method: 'POST',
        url: '/chantier-members',
        headers: auth(beta.admin.token),
        payload: { chantier_id: chantierId, user_id: complice.id, role: 'ouvrier' },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  /**
   * Plusieurs photos par urgence. Elles vivent dans la galerie du chantier,
   * rattachees a l'urgence ; `photo_url` garde la premiere pour les anciens
   * clients.
   */
  describe("photos d'une urgence", () => {
    const photos = [
      { url: 'http://localhost:3000/files/u1.jpg', thumbnail_url: 'http://localhost:3000/files/u1_thumb.jpg' },
      { url: 'http://localhost:3000/files/u2.jpg' },
    ];
    const lister = () => app.inject({ method: 'GET', url: `/emergencies?chantier_id=${chantierId}`, headers: auth(admin.token) }).then((r) => r.json().data);

    it('en accepte plusieurs a la creation, et la premiere devient photo_url', async () => {
      const res = await app.inject({ method: 'POST', url: '/emergencies', headers: auth(ouvrier.token), payload: { chantier_id: chantierId, photos } });

      expect(res.statusCode).toBe(201);
      expect(res.json().photos).toHaveLength(2);
      expect(res.json().photo_url).toContain('/files/u1.jpg');
      const dansGalerie = await app.db('photo').where({ emergency_id: res.json().id });
      expect(dansGalerie).toHaveLength(2);
      expect(dansGalerie.every((p) => p.chantier_id === chantierId && p.uploaded_by === ouvrier.id)).toBe(true);
    });

    it("l'ancienne forme a une photo reste acceptee et apparait dans photos", async () => {
      const res = await app.inject({ method: 'POST', url: '/emergencies', headers: auth(ouvrier.token), payload: { chantier_id: chantierId, photo_url: 'http://localhost:3000/files/seule.jpg' } });

      expect(res.statusCode).toBe(201);
      expect(res.json().photos).toHaveLength(1);
      expect((await lister()).find((e: { id: string }) => e.id === res.json().id).photos).toHaveLength(1);
    });

    it("l'auteur peut en ajouter apres coup", async () => {
      const res = await app.inject({ method: 'POST', url: `/emergencies/${emergencyId}/photos`, headers: auth(ouvrier.token), payload: { photos } });

      expect(res.statusCode).toBe(200);
      expect(res.json().photos).toHaveLength(2);
      // L'urgence n'avait pas de photo : la premiere ajoutee devient photo_url.
      expect((await app.db('chantier_emergency').where({ id: emergencyId }).first()).photo_url).toContain('/files/u1.jpg');
    });

    it("un simple participant sans droit d'edition ne peut pas en ajouter a l'urgence d'un autre", async () => {
      const autre = await createUser(app, { organizationId, role: 'employee' });
      await app.inject({ method: 'POST', url: '/chantier-members', headers: auth(admin.token), payload: { chantier_id: chantierId, user_id: autre.id, role: 'ouvrier' } });

      const res = await app.inject({ method: 'POST', url: `/emergencies/${emergencyId}/photos`, headers: auth(autre.token), payload: { photos } });

      expect(res.statusCode).toBe(403);
    });

    it("la galerie du chantier ne les montre pas", async () => {
      await app.inject({ method: 'POST', url: '/emergencies', headers: auth(ouvrier.token), payload: { chantier_id: chantierId, photos } });
      await app.inject({ method: 'POST', url: '/photos', headers: auth(admin.token), payload: { chantier_id: chantierId, url: 'http://localhost:3000/files/chantier.jpg' } });

      const galerie = await app.inject({ method: 'GET', url: `/photos?chantier_id=${chantierId}`, headers: auth(admin.token) });

      expect(galerie.json().meta.total).toBe(1);
      expect(galerie.json().data[0].url).toContain('/files/chantier.jpg');
    });

    it("supprimer l'urgence emporte ses photos", async () => {
      const created = (await app.inject({ method: 'POST', url: '/emergencies', headers: auth(ouvrier.token), payload: { chantier_id: chantierId, photos } })).json();

      await app.inject({ method: 'DELETE', url: `/emergencies/${created.id}`, headers: auth(admin.token) });

      expect(await app.db('photo').where({ emergency_id: created.id })).toHaveLength(0);
    });
  });
});
