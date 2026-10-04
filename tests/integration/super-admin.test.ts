import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, auth } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import { createOrgWithAdmin, createUser, createSuperAdmin, login, TEST_PASSWORD, type TestUser } from '../helpers/factories';

/**
 * Console du super admin Buildr.
 *
 * C'est la surface la plus puissante du produit : elle traverse toutes les
 * organisations, coupe des comptes, remet des mots de passe et permet de se
 * faire passer pour l'administrateur d'une entreprise cliente. Un garde oublie
 * sur une seule de ces routes, et n'importe quel client dispose du meme
 * pouvoir sur tous les autres.
 */
describe('Console super admin', () => {
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
    ouvrier = await createUser(app, { organizationId, role: 'employee' });
    superAdmin = await createSuperAdmin(app, organizationId);
  });

  describe('acces', () => {
    /** Toutes les routes de la console, avec une methode et un corps valides. */
    const ROUTES: [string, string][] = [
      ['GET', '/super-admin/overview'],
      ['GET', '/super-admin/orgs'],
      ['GET', '/super-admin/users'],
      ['GET', '/super-admin/chantiers'],
      ['GET', '/super-admin/audit'],
      ['GET', '/super-admin/errors'],
      ['GET', '/super-admin/feedbacks'],
    ];

    it.each(ROUTES)("%s %s est refuse a un administrateur d'organisation", async (method, url) => {
      const res = await app.inject({ method: method as 'GET', url, headers: auth(admin.token) });
      expect(res.statusCode).toBe(403);
    });

    it.each(ROUTES)('%s %s est refuse a un ouvrier', async (method, url) => {
      const res = await app.inject({ method: method as 'GET', url, headers: auth(ouvrier.token) });
      expect(res.statusCode).toBe(403);
    });

    it.each(ROUTES)('%s %s est ouvert au super admin', async (method, url) => {
      const res = await app.inject({ method: method as 'GET', url, headers: auth(superAdmin.token) });
      expect(res.statusCode).toBe(200);
    });

    it('les actions destructrices sont refusees a un administrateur', async () => {
      const actions: [string, string][] = [
        ['POST', `/super-admin/users/${ouvrier.id}/disable`],
        ['POST', `/super-admin/users/${ouvrier.id}/kick-sessions`],
        ['POST', `/super-admin/users/${ouvrier.id}/force-reset`],
        ['POST', `/super-admin/orgs/${organizationId}/impersonate`],
        ['DELETE', `/super-admin/users/${ouvrier.id}`],
      ];

      for (const [method, url] of actions) {
        const res = await app.inject({ method: method as 'POST', url, headers: auth(admin.token) });
        expect(res.statusCode, `${method} ${url}`).toBe(403);
      }
      expect((await app.db('user').where({ id: ouvrier.id }).first()).is_active).toBe(true);
    });
  });

  describe('usurpation d identite', () => {
    it("donne un jeton agissant au nom de l'administrateur de l'organisation", async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/super-admin/orgs/${organizationId}/impersonate`,
        headers: auth(superAdmin.token),
      });

      expect(res.statusCode).toBe(200);
      const moi = await app.inject({ method: 'GET', url: '/auth/me', headers: auth(res.json().access_token) });
      expect(moi.statusCode).toBe(200);
      expect(moi.json().id).toBe(res.json().user_id);
    });

    it('laisse une trace nominative', async () => {
      // Se faire passer pour quelqu'un doit rester attribuable : c'est la seule
      // garantie qu'un client a contre un usage abusif de ce pouvoir.
      await app.inject({
        method: 'POST',
        url: `/super-admin/orgs/${organizationId}/impersonate`,
        headers: auth(superAdmin.token),
      });

      const trace = await app.db('audit_log').where({ action: 'org.impersonate' }).first();
      expect(trace).toBeTruthy();
      expect(trace.super_admin_id).toBe(superAdmin.id);
      expect(trace.target_id).toBe(organizationId);
    });

    it("echoue sur une organisation sans administrateur", async () => {
      const orphelin = await app.db('organization').insert({ name: 'Sans admin' }).returning('id');
      const res = await app.inject({
        method: 'POST',
        url: `/super-admin/orgs/${orphelin[0].id}/impersonate`,
        headers: auth(superAdmin.token),
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('couper un compte', () => {
    it('empeche toute nouvelle connexion', async () => {
      await app.inject({
        method: 'POST',
        url: `/super-admin/users/${ouvrier.id}/disable`,
        headers: auth(superAdmin.token),
      });

      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: ouvrier.email, password: TEST_PASSWORD },
      });
      expect(res.statusCode).toBe(403);
    });

    it("coupe aussi la session en cours", async () => {
      // Sinon couper un compte ne fait rien pendant un quart d'heure : la
      // personne garde tous ses droits jusqu'a l'expiration de son jeton. C'est
      // pourtant le cas ou l'on coupe dans l'urgence — compte compromis, ou
      // collaborateur dont on vient de se separer.
      expect((await app.inject({ method: 'GET', url: '/auth/me', headers: auth(ouvrier.token) })).statusCode).toBe(200);

      await app.inject({
        method: 'POST',
        url: `/super-admin/users/${ouvrier.id}/disable`,
        headers: auth(superAdmin.token),
      });

      const res = await app.inject({ method: 'GET', url: '/auth/me', headers: auth(ouvrier.token) });
      expect(res.statusCode).toBe(401);
    });

    it('le compte redevient utilisable une fois reactive', async () => {
      await app.inject({ method: 'POST', url: `/super-admin/users/${ouvrier.id}/disable`, headers: auth(superAdmin.token) });
      await app.inject({ method: 'POST', url: `/super-admin/users/${ouvrier.id}/enable`, headers: auth(superAdmin.token) });

      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: ouvrier.email, password: TEST_PASSWORD },
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('couper les sessions', () => {
    it("invalide le jeton en cours", async () => {
      await app.inject({
        method: 'POST',
        url: `/super-admin/users/${ouvrier.id}/kick-sessions`,
        headers: auth(superAdmin.token),
      });

      const res = await app.inject({ method: 'GET', url: '/auth/me', headers: auth(ouvrier.token) });
      expect(res.statusCode).toBe(401);
    });

    it('laisse le compte se reconnecter ensuite', async () => {
      await app.inject({
        method: 'POST',
        url: `/super-admin/users/${ouvrier.id}/kick-sessions`,
        headers: auth(superAdmin.token),
      });

      expect(await login(app, ouvrier.email)).toBeTruthy();
    });
  });

  describe('remise a zero du mot de passe', () => {
    it('rend un mot de passe temporaire qui fonctionne, et invalide l ancien', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/super-admin/users/${ouvrier.id}/force-reset`,
        headers: auth(superAdmin.token),
      });
      expect(res.statusCode).toBe(200);
      const temporaire = res.json().temporary_password;

      const avecAncien = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: ouvrier.email, password: TEST_PASSWORD },
      });
      const avecNouveau = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: ouvrier.email, password: temporaire },
      });

      expect(avecAncien.statusCode).toBe(401);
      expect(avecNouveau.statusCode).toBe(200);
    });

    it("coupe la session en cours", async () => {
      // On remet un mot de passe a zero quand un compte est compromis : laisser
      // la session courante ouverte laisse l'intrus en place.
      await app.inject({
        method: 'POST',
        url: `/super-admin/users/${ouvrier.id}/force-reset`,
        headers: auth(superAdmin.token),
      });

      const res = await app.inject({ method: 'GET', url: '/auth/me', headers: auth(ouvrier.token) });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('suppression de compte', () => {
    it('refuse de se supprimer soi-meme', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/super-admin/users/${superAdmin.id}`,
        headers: auth(superAdmin.token),
      });

      expect(res.statusCode).toBe(400);
      expect(await app.db('user').where({ id: superAdmin.id }).first()).toBeTruthy();
    });

    it('supprime un autre compte et le consigne', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/super-admin/users/${ouvrier.id}`,
        headers: auth(superAdmin.token),
      });

      expect(res.statusCode).toBe(204);
      // Anonymise, pas efface : ses photos et messages restent dans les chantiers.
      const row = await app.db('user').where({ id: ouvrier.id }).first();
      expect(row.is_active).toBe(false);
      expect(row.deleted_at).toBeTruthy();
      expect(await app.db('audit_log').where({ action: 'user.delete', target_id: ouvrier.id }).first()).toBeTruthy();
    });

    it('purge physiquement sur demande explicite, et le consigne a part', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/super-admin/users/${ouvrier.id}?purge=1`,
        headers: auth(superAdmin.token),
      });

      expect(res.statusCode).toBe(204);
      expect(await app.db('user').where({ id: ouvrier.id }).first()).toBeUndefined();
      expect(await app.db('audit_log').where({ action: 'user.purge', target_id: ouvrier.id }).first()).toBeTruthy();
    });
  });

  describe('journal d audit', () => {
    it('remonte les actions dans la console', async () => {
      await app.inject({ method: 'POST', url: `/super-admin/users/${ouvrier.id}/disable`, headers: auth(superAdmin.token) });

      const res = await app.inject({ method: 'GET', url: '/super-admin/audit', headers: auth(superAdmin.token) });

      expect(res.statusCode).toBe(200);
      expect(res.json().data.map((e: { action: string }) => e.action)).toContain('user.disable');
    });
  });
});
