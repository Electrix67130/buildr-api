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
});
