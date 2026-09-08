import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, auth } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import { createOrgWithAdmin, createUser, type TestUser } from '../helpers/factories';

/**
 * Cloisonnement entre organisations.
 *
 * Buildr est multi-locataire : deux entreprises concurrentes peuvent avoir un
 * compte. Une fuite entre organisations n'est pas un desagrement, c'est une
 * violation de confidentialite — et elle ne se voit jamais a l'usage normal,
 * puisqu'il faut connaitre l'identifiant d'une ressource d'autrui pour la
 * declencher. D'ou ces tests.
 *
 * Convention : « alpha » est l'attaquant, « beta » la victime.
 */
describe('Cloisonnement entre organisations', () => {
  let app: FastifyInstance;
  let alphaAdmin: TestUser;
  let betaAdmin: TestUser;
  let betaEmployee: TestUser;
  let betaChantierId: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(app.db);

    const alpha = await createOrgWithAdmin(app, 'Alpha TP');
    alphaAdmin = alpha.admin;

    const beta = await createOrgWithAdmin(app, 'Beta Constructions');
    betaAdmin = beta.admin;
    betaEmployee = await createUser(app, { organizationId: beta.organizationId, role: 'employee' });

    const res = await app.inject({
      method: 'POST',
      url: '/chantiers',
      headers: auth(betaAdmin.token),
      payload: { name: 'Chantier confidentiel de Beta', address: '1 rue de Beta' },
    });
    expect(res.statusCode).toBe(201);
    betaChantierId = res.json().id;
  });

  it("n'expose pas les chantiers d'une autre organisation dans la liste", async () => {
    const res = await app.inject({ method: 'GET', url: '/chantiers', headers: auth(alphaAdmin.token) });

    expect(res.statusCode).toBe(200);
    const noms = res.json().data.map((c: { name: string }) => c.name);
    expect(noms).not.toContain('Chantier confidentiel de Beta');
  });

  it("refuse la lecture d'un chantier d'une autre organisation", async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/chantiers/${betaChantierId}`,
      headers: auth(alphaAdmin.token),
    });

    // 404 ou 403 : les deux refusent. Ce qui compte est que le contenu ne sorte pas.
    expect(res.statusCode).not.toBe(200);
    expect(res.body).not.toContain('Chantier confidentiel de Beta');
  });

  it("refuse la modification d'un chantier d'une autre organisation", async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/chantiers/${betaChantierId}`,
      headers: auth(alphaAdmin.token),
      payload: { name: 'Detourne par Alpha' },
    });

    expect(res.statusCode).not.toBe(200);

    const chantier = await app.db('chantier').where({ id: betaChantierId }).first();
    expect(chantier.name).toBe('Chantier confidentiel de Beta');
  });

  it("refuse la suppression d'un chantier d'une autre organisation", async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/chantiers/${betaChantierId}`,
      headers: auth(alphaAdmin.token),
    });

    expect(res.statusCode).not.toBe(204);

    const encoreLa = await app.db('chantier').where({ id: betaChantierId }).first();
    expect(encoreLa).toBeTruthy();
  });

  it("n'annule pas une invitation d'une autre organisation", async () => {
    // Regression : cette faille a existe. L'authentification seule suffisait a
    // annuler l'invitation de n'importe quelle organisation.
    const creee = await app.inject({
      method: 'POST',
      url: '/invitations',
      headers: auth(betaAdmin.token),
      payload: { email: 'recrue@beta.fr', role: 'employee' },
    });
    expect(creee.statusCode).toBe(201);
    const invitationId = creee.json().id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/invitations/${invitationId}`,
      headers: auth(alphaAdmin.token),
    });

    // 404 et non 403 : repondre « interdit » confirmerait que l'invitation existe.
    expect(res.statusCode).toBe(404);
    const encoreLa = await app.db('invitation').where({ id: invitationId }).first();
    expect(encoreLa).toBeTruthy();
  });

  it("n'expose pas la fiche d'un utilisateur d'une autre organisation", async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/users/${betaEmployee.id}`,
      headers: auth(alphaAdmin.token),
    });

    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain(betaEmployee.email);
  });

  it("ne desactive pas le compte d'un utilisateur d'une autre organisation", async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/users/${betaEmployee.id}`,
      headers: auth(alphaAdmin.token),
      payload: { is_active: false },
    });

    expect(res.statusCode).not.toBe(200);

    const cible = await app.db('user').where({ id: betaEmployee.id }).first();
    expect(cible.is_active).toBe(true);
  });

  it("ne renomme pas sa propre organisation en editant un membre d'une autre", async () => {
    // Effet de bord redoute : la cascade sur company_name est indexee sur
    // l'organisation de l'EDITEUR, pas sur celle de la cible.
    await app.inject({
      method: 'PATCH',
      url: `/users/${betaEmployee.id}`,
      headers: auth(alphaAdmin.token),
      payload: { company_name: 'Renommage sauvage' },
    });

    const orgAlpha = await app.db('organization').where({ id: alphaAdmin.organizationId }).first();
    expect(orgAlpha.name).toBe('Alpha TP');
  });

  it("ne supprime pas un utilisateur d'une autre organisation", async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/users/${betaEmployee.id}`,
      headers: auth(alphaAdmin.token),
    });

    expect(res.statusCode).not.toBe(204);
    const encoreLa = await app.db('user').where({ id: betaEmployee.id }).first();
    expect(encoreLa).toBeTruthy();
  });
});
