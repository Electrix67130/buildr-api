import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, auth } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import { createOrgWithAdmin, createUser, type TestUser } from '../helpers/factories';

/**
 * Droits par defaut de chaque role, regles par l'organisation.
 *
 * Chaque entreprise decide de ce qu'un ouvrier, un client ou un gestionnaire
 * reseau voit en arrivant sur un chantier. Changer le reglage d'un role
 * l'applique a tous ses membres, sur tous les chantiers de l'organisation —
 * et seulement de celle-la.
 */
describe('Droits par defaut des roles', () => {
  let app: FastifyInstance;
  let admin: TestUser;
  let ouvrier: TestUser;
  let autreOuvrier: TestUser;
  let client: TestUser;
  let chantierId: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const nouveauChantier = async (compte: TestUser, name = 'Pont de la Loire') =>
    (await app.inject({ method: 'POST', url: '/chantiers', headers: auth(compte.token), payload: { name } })).json().id as string;

  const ajouter = async (membre: TestUser, role: string, chantier = chantierId, par = admin) =>
    (
      await app.inject({
        method: 'POST',
        url: '/chantier-members',
        headers: auth(par.token),
        payload: { chantier_id: chantier, user_id: membre.id, role },
      })
    ).json();

  const droitsDe = async (membre: TestUser, chantier = chantierId) =>
    app.db('chantier_member').where({ chantier_id: chantier, user_id: membre.id }).first();

  const regler = (role: string, droits: Record<string, boolean>, compte = admin) =>
    app.inject({ method: 'PUT', url: `/role-permissions/${role}`, headers: auth(compte.token), payload: droits });

  const TOUT_OUVERT = {
    can_view_comments: true,
    can_view_photos: true,
    can_view_documents: true,
    can_view_steps: true,
    can_view_team: true,
    can_edit: true,
  };

  beforeEach(async () => {
    await truncateAll(app.db);
    const org = await createOrgWithAdmin(app, 'Alpha TP');
    admin = org.admin;
    ouvrier = await createUser(app, { organizationId: org.organizationId, role: 'employee' });
    autreOuvrier = await createUser(app, { organizationId: org.organizationId, role: 'employee' });
    client = await createUser(app, { organizationId: org.organizationId, role: 'client' });
    chantierId = await nouveauChantier(admin);
  });

  it("liste les quatre roles avec les valeurs d'origine, et combien de membres chacun touche", async () => {
    await ajouter(ouvrier, 'ouvrier');
    const res = await app.inject({ method: 'GET', url: '/role-permissions', headers: auth(admin.token) });

    expect(res.statusCode).toBe(200);
    const roles = res.json();
    expect(roles.map((r: { role: string }) => r.role)).toEqual(['manager', 'ouvrier', 'client', 'gestionnaire_reseau']);
    expect(roles[1]).toMatchObject({ role: 'ouvrier', customized: false, member_count: 1, can_view_documents: true, can_edit: false });
    expect(roles[3]).toMatchObject({ role: 'gestionnaire_reseau', can_view_comments: false, can_view_documents: true });
  });

  it("est reserve aux administrateurs", async () => {
    expect((await app.inject({ method: 'GET', url: '/role-permissions', headers: auth(ouvrier.token) })).statusCode).toBe(403);
    expect((await regler('client', TOUT_OUVERT, ouvrier)).statusCode).toBe(403);
  });

  it('un nouveau membre recoit les droits regles pour son role', async () => {
    await regler('client', { ...TOUT_OUVERT, can_view_documents: false, can_edit: false });

    const membre = await ajouter(client, 'client');
    expect(membre).toMatchObject({ can_view_steps: true, can_view_documents: false, can_edit: false });
  });

  it('applique le reglage a tous les membres du role, sur tous les chantiers, et seulement eux', async () => {
    const second = await nouveauChantier(admin, 'Ecole');
    await ajouter(ouvrier, 'ouvrier');
    await ajouter(autreOuvrier, 'ouvrier', second);
    await ajouter(client, 'client');
    // Un ajustement fait a la main : il sera remplace, comme convenu.
    await app.db('chantier_member').where({ chantier_id: chantierId, user_id: ouvrier.id }).update({ can_view_team: false });

    const res = await regler('ouvrier', { ...TOUT_OUVERT, can_view_documents: false });
    expect(res.json()).toMatchObject({ role: 'ouvrier', customized: true, updated_members: 2 });

    expect(await droitsDe(ouvrier)).toMatchObject({ can_view_documents: false, can_view_team: true, can_edit: true });
    expect(await droitsDe(autreOuvrier, second)).toMatchObject({ can_view_documents: false, can_edit: true });
    // Les clients ne bougent pas.
    expect(await droitsDe(client)).toMatchObject({ can_view_documents: false, can_view_steps: false, can_edit: false });
  });

  it("ne touche pas aux chantiers d'une autre organisation", async () => {
    const beta = await createOrgWithAdmin(app, 'Beta BTP');
    const ouvrierBeta = await createUser(app, { organizationId: beta.organizationId, role: 'employee' });
    const chantierBeta = await nouveauChantier(beta.admin);
    await ajouter(ouvrierBeta, 'ouvrier', chantierBeta, beta.admin);

    await regler('ouvrier', { ...TOUT_OUVERT, can_view_photos: false });

    expect(await droitsDe(ouvrierBeta, chantierBeta)).toMatchObject({ can_view_photos: true });
  });

  it('revenir aux valeurs d origine les applique a tous les membres du role', async () => {
    await ajouter(ouvrier, 'ouvrier');
    await regler('ouvrier', { ...TOUT_OUVERT, can_view_photos: false });

    const res = await app.inject({ method: 'DELETE', url: '/role-permissions/ouvrier', headers: auth(admin.token) });
    expect(res.json()).toEqual({ role: 'ouvrier', updated_members: 1 });
    expect(await droitsDe(ouvrier)).toMatchObject({ can_view_photos: true, can_edit: false });

    const roles = (await app.inject({ method: 'GET', url: '/role-permissions', headers: auth(admin.token) })).json();
    expect(roles[1].customized).toBe(false);
  });

  it("changer le role d'un membre lui donne les droits regles pour le nouveau role", async () => {
    await regler('client', { ...TOUT_OUVERT, can_view_comments: false, can_edit: false });
    const membre = await ajouter(ouvrier, 'ouvrier');

    await app.inject({ method: 'PATCH', url: `/chantier-members/${membre.id}`, headers: auth(admin.token), payload: { role: 'client' } });
    expect(await droitsDe(ouvrier)).toMatchObject({ role: 'client', can_view_comments: false, can_view_documents: true });
  });

  it('refuse un reglage incomplet ou un role inconnu', async () => {
    expect((await regler('ouvrier', { can_view_comments: true })).statusCode).toBe(400);
    expect((await regler('stagiaire', TOUT_OUVERT)).statusCode).toBe(400);
  });
});
