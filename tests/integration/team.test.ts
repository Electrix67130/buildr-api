import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, auth } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import { createOrgWithAdmin, createUser, type TestUser } from '../helpers/factories';

/**
 * Equipes : quels ouvriers sont rattaches a quel chef de chantier.
 *
 * Le rattachement determine ce que le chef voit de ses hommes — et, par
 * ricochet, ce que `GET /users` lui renvoie. Une equipe lisible d'une
 * organisation a l'autre revient a divulguer l'organigramme d'une entreprise
 * concurrente.
 */
describe('Equipes', () => {
  let app: FastifyInstance;
  let organizationId: string;
  let admin: TestUser;
  let chef: TestUser;
  let ouvrier: TestUser;

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
    chef = await createUser(app, { organizationId, role: 'manager' });
    ouvrier = await createUser(app, { organizationId, role: 'employee' });
  });

  const rattacher = (token: string, manager: TestUser, membre: TestUser) =>
    app.inject({
      method: 'POST',
      url: '/teams',
      headers: auth(token),
      payload: { manager_id: manager.id, user_id: membre.id },
    });

  describe('composition', () => {
    it("l'admin rattache un ouvrier a un chef de chantier", async () => {
      const res = await rattacher(admin.token, chef, ouvrier);

      expect(res.statusCode).toBe(201);
      expect(await app.db('team_member').where({ manager_id: chef.id, user_id: ouvrier.id }).first()).toBeTruthy();
    });

    it('refuse un rattachement en double', async () => {
      await rattacher(admin.token, chef, ouvrier);
      expect((await rattacher(admin.token, chef, ouvrier)).statusCode).toBe(409);
    });

    it("refuse de rattacher a quelqu'un qui n'est pas chef de chantier", async () => {
      const autreOuvrier = await createUser(app, { organizationId, role: 'employee' });
      expect((await rattacher(admin.token, autreOuvrier, ouvrier)).statusCode).toBe(400);
    });

    it.each([
      ['chef de chantier', () => chef],
      ['ouvrier', () => ouvrier],
    ])('un %s ne compose pas les equipes', async (_label, get) => {
      const res = await rattacher(get().token, chef, ouvrier);
      expect(res.statusCode).toBe(403);
      expect(await app.db('team_member').count('* as n').first()).toMatchObject({ n: '0' });
    });
  });

  describe('consultation', () => {
    beforeEach(async () => {
      await rattacher(admin.token, chef, ouvrier);
    });

    it("le chef de chantier consulte sa propre equipe", async () => {
      const res = await app.inject({ method: 'GET', url: `/teams/${chef.id}`, headers: auth(chef.token) });

      expect(res.statusCode).toBe(200);
      expect(res.json().data).toHaveLength(1);
    });

    it("l'admin consulte l'equipe d'un de ses chefs de chantier", async () => {
      const res = await app.inject({ method: 'GET', url: `/teams/${chef.id}`, headers: auth(admin.token) });
      expect(res.statusCode).toBe(200);
    });

    it("un ouvrier ne consulte pas l'equipe d'un autre", async () => {
      const res = await app.inject({ method: 'GET', url: `/teams/${chef.id}`, headers: auth(ouvrier.token) });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('cloisonnement entre organisations', () => {
    let beta: { organizationId: string; admin: TestUser };
    let chefBeta: TestUser;
    let ouvrierBeta: TestUser;

    beforeEach(async () => {
      beta = await createOrgWithAdmin(app, 'Beta Constructions');
      chefBeta = await createUser(app, { organizationId: beta.organizationId, role: 'manager' });
      ouvrierBeta = await createUser(app, { organizationId: beta.organizationId, role: 'employee' });
      await rattacher(beta.admin.token, chefBeta, ouvrierBeta);
    });

    it("l'equipe d'une autre organisation n'est pas consultable", async () => {
      // Etre administrateur ne vaut que chez soi.
      const res = await app.inject({
        method: 'GET',
        url: `/teams/${chefBeta.id}`,
        headers: auth(admin.token),
      });

      expect(res.statusCode).not.toBe(200);
      expect(res.body).not.toContain(ouvrierBeta.email);
    });

    it("un rattachement d'une autre organisation n'est pas supprimable", async () => {
      const lien = await app.db('team_member').where({ manager_id: chefBeta.id }).first();

      const res = await app.inject({
        method: 'DELETE',
        url: `/teams/${lien.id}`,
        headers: auth(admin.token),
      });

      expect(res.statusCode).not.toBe(204);
      expect(await app.db('team_member').where({ id: lien.id }).first()).toBeTruthy();
    });

    it("on ne rattache pas quelqu'un d'une autre organisation a son equipe", async () => {
      const res = await rattacher(admin.token, chef, ouvrierBeta);

      expect(res.statusCode).not.toBe(201);
    });
  });

  describe('retrait', () => {
    it("l'admin retire un ouvrier de l'equipe", async () => {
      await rattacher(admin.token, chef, ouvrier);
      const lien = await app.db('team_member').where({ manager_id: chef.id }).first();

      const res = await app.inject({ method: 'DELETE', url: `/teams/${lien.id}`, headers: auth(admin.token) });

      expect(res.statusCode).toBe(204);
      expect(await app.db('team_member').where({ id: lien.id }).first()).toBeUndefined();
    });

    it("un chef de chantier ne retire pas de son propre chef", async () => {
      await rattacher(admin.token, chef, ouvrier);
      const lien = await app.db('team_member').where({ manager_id: chef.id }).first();

      const res = await app.inject({ method: 'DELETE', url: `/teams/${lien.id}`, headers: auth(chef.token) });

      expect(res.statusCode).toBe(403);
    });
  });
});
