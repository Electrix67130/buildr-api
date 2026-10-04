import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, auth } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import { createOrgWithAdmin, createUser, login, type TestUser } from '../helpers/factories';

/**
 * Droits par role, a l'interieur d'une meme organisation.
 *
 * La regle metier : l'admin dirige, le manager encadre, l'employe execute, le
 * client observe. Ces tests verifient que la frontiere tient cote serveur —
 * masquer un bouton dans l'interface ne protege rien.
 */
describe('Droits par role', () => {
  let app: FastifyInstance;
  let organizationId: string;
  let admin: TestUser;
  let manager: TestUser;
  let employee: TestUser;
  let client: TestUser;

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
    manager = await createUser(app, { organizationId, role: 'manager' });
    employee = await createUser(app, { organizationId, role: 'employee' });
    client = await createUser(app, { organizationId, role: 'client' });
  });

  const creerChantier = (token: string) =>
    app.inject({
      method: 'POST',
      url: '/chantiers',
      headers: auth(token),
      payload: { name: 'Renovation ecole', address: '3 rue des Lilas' },
    });

  describe('creation de chantier', () => {
    it("l'admin peut creer un chantier", async () => {
      expect((await creerChantier(admin.token)).statusCode).toBe(201);
    });

    it.each([
      ['manager', () => manager],
      ['employe', () => employee],
      ['client', () => client],
    ])('un %s ne peut pas creer de chantier', async (_label, get) => {
      const res = await creerChantier(get().token);
      expect(res.statusCode).toBe(403);
      expect(await app.db('chantier').count('* as n').first()).toMatchObject({ n: '0' });
    });
  });

  describe('invitations', () => {
    it("l'admin peut inviter un employe", async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/invitations',
        headers: auth(admin.token),
        payload: { email: 'recrue@alpha.fr', role: 'employee' },
      });
      expect(res.statusCode).toBe(201);
    });

    it('le manager peut inviter un employe', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/invitations',
        headers: auth(manager.token),
        payload: { email: 'recrue2@alpha.fr', role: 'employee' },
      });
      expect(res.statusCode).toBe(201);
    });

    it("le manager ne peut pas nommer d'admin", async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/invitations',
        headers: auth(manager.token),
        payload: { email: 'complice@alpha.fr', role: 'admin' },
      });
      expect(res.statusCode).toBe(403);
    });

    it.each([
      ['employe', () => employee],
      ['client', () => client],
    ])("un %s ne peut pas inviter", async (_label, get) => {
      const res = await app.inject({
        method: 'POST',
        url: '/invitations',
        headers: auth(get().token),
        payload: { email: 'intrus@alpha.fr', role: 'employee' },
      });
      expect(res.statusCode).toBe(403);
    });

    it.each([
      ['employe', () => employee],
      ['client', () => client],
    ])("un %s ne peut pas lister les invitations", async (_label, get) => {
      // Gerer les invitations est un acte d'administration, au meme titre que
      // les creer ou les annuler.
      const res = await app.inject({ method: 'GET', url: '/invitations', headers: auth(get().token) });
      expect(res.statusCode).toBe(403);
    });

    it.each([
      ['admin', () => admin],
      ['manager', () => manager],
    ])('un %s peut lister les invitations', async (_label, get) => {
      const res = await app.inject({ method: 'GET', url: '/invitations', headers: auth(get().token) });
      expect(res.statusCode).toBe(200);
    });

    it("ne renvoie jamais le jeton, meme a un admin", async () => {
      // Le jeton ne doit exister qu'a deux endroits : la base, et le mail de son
      // destinataire. Il n'a rien a faire dans une reponse d'API.
      await app.inject({
        method: 'POST',
        url: '/invitations',
        headers: auth(admin.token),
        payload: { email: 'recrue@alpha.fr', role: 'employee' },
      });
      const jeton = (await app.db('invitation').where({ email: 'recrue@alpha.fr' }).first()).token;

      const res = await app.inject({ method: 'GET', url: '/invitations', headers: auth(admin.token) });

      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain(jeton);
      expect(res.json().data[0]).not.toHaveProperty('token');
    });

    it("un employe ne peut pas recuperer le jeton d'une invitation admin", async () => {
      // Consequence si le jeton fuite : POST /auth/register l'accepte sans
      // authentification et cree un compte avec le role qu'il porte. Un employe
      // qui lit ce jeton se promeut administrateur.
      const creee = await app.inject({
        method: 'POST',
        url: '/invitations',
        headers: auth(admin.token),
        payload: { email: 'futur.admin@alpha.fr', role: 'admin' },
      });
      expect(creee.statusCode).toBe(201);
      const jeton = (await app.db('invitation').where({ email: 'futur.admin@alpha.fr' }).first()).token;

      const res = await app.inject({ method: 'GET', url: '/invitations', headers: auth(employee.token) });

      expect(res.body).not.toContain(jeton);
    });
  });

  describe('suppression de compte', () => {
    it("l'admin peut supprimer un membre : le compte est anonymise, pas efface", async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/users/${employee.id}`,
        headers: auth(admin.token),
      });

      expect(res.statusCode).toBe(204);
      const row = await app.db('user').where({ id: employee.id }).first();
      expect(row).toBeTruthy();
      expect(row.is_active).toBe(false);
      expect(row.deleted_at).toBeTruthy();
      expect(row.email).toBe(`deleted-${employee.id}@deleted.invalid`);
      expect(await app.db('organization_member').where({ user_id: employee.id })).toHaveLength(0);
    });

    it("ses messages et photos survivent sous « Compte supprime »", async () => {
      const chantier = (await app.inject({ method: 'POST', url: '/chantiers', headers: auth(admin.token), payload: { name: 'Pont' } })).json();
      await app.inject({ method: 'POST', url: '/chantier-members', headers: auth(admin.token), payload: { chantier_id: chantier.id, user_id: employee.id, role: 'ouvrier', can_edit: true } });
      const message = (await app.inject({ method: 'POST', url: '/comments', headers: auth(employee.token), payload: { chantier_id: chantier.id, content: 'Coffrage fini' } })).json();
      const photo = (await app.inject({ method: 'POST', url: '/photos', headers: auth(employee.token), payload: { chantier_id: chantier.id, url: 'http://localhost:3000/files/p.jpg' } })).json();

      await app.inject({ method: 'DELETE', url: `/users/${employee.id}`, headers: auth(admin.token) });

      expect(await app.db('comment').where({ id: message.id }).first()).toBeTruthy();
      expect(await app.db('photo').where({ id: photo.id }).first()).toBeTruthy();
      const liste = await app.inject({ method: 'GET', url: `/comments?chantier_id=${chantier.id}`, headers: auth(admin.token) });
      expect(liste.json().data[0].first_name).toBe('Compte');
    });

    it("refuse de supprimer le seul administrateur d'une autre organisation", async () => {
      const autre = await createOrgWithAdmin(app, 'Beta BTP');
      // Beta a d'autres membres : sans son admin, plus personne ne la gere.
      await createUser(app, { organizationId: autre.organizationId, role: 'employee' });
      // L'admin de Beta rejoint Alpha comme employe : Alpha peut le voir, mais
      // le supprimer laisserait Beta sans administrateur.
      await app.db('organization_member').insert({ organization_id: organizationId, user_id: autre.admin.id, role: 'employee' });

      const res = await app.inject({ method: 'DELETE', url: `/users/${autre.admin.id}`, headers: auth(admin.token) });

      expect(res.statusCode).toBe(409);
      expect((await app.db('user').where({ id: autre.admin.id }).first()).is_active).toBe(true);
    });

    it.each([
      ['manager', () => manager],
      ['employe', () => employee],
    ])('un %s ne peut pas supprimer un compte', async (_label, get) => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/users/${client.id}`,
        headers: auth(get().token),
      });
      expect(res.statusCode).toBe(403);
      expect(await app.db('user').where({ id: client.id }).first()).toBeTruthy();
    });
  });

  describe('modification de profil', () => {
    it('un employe peut modifier son propre telephone', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/users/${employee.id}`,
        headers: auth(employee.token),
        payload: { phone: '06 12 34 56 78' },
      });
      expect(res.statusCode).toBe(200);
      // Un seul format en base, quelle que soit la saisie.
      expect(res.json().phone).toBe('+33612345678');
      expect((await app.db('user').where({ id: employee.id }).first()).phone).toBe('+33612345678');
    });

    it('refuse un telephone invalide sans toucher au profil', async () => {
      const avant = (await app.db('user').where({ id: employee.id }).first()).phone;
      const res = await app.inject({
        method: 'PATCH',
        url: `/users/${employee.id}`,
        headers: auth(employee.token),
        payload: { phone: '06 12 34' },
      });
      expect(res.statusCode).toBe(400);
      expect((await app.db('user').where({ id: employee.id }).first()).phone).toBe(avant);
    });

    it("un employe ne peut pas modifier le profil d'un collegue", async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/users/${manager.id}`,
        headers: auth(employee.token),
        payload: { phone: '0600000001' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('un employe ne peut pas se promouvoir lui-meme', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/users/${employee.id}`,
        headers: auth(employee.token),
        payload: { role: 'admin' },
      });

      expect(res.statusCode).toBe(403);
      const membership = await app
        .db('organization_member')
        .where({ user_id: employee.id, organization_id: organizationId })
        .first();
      expect(membership.role).toBe('employee');
    });
  });

  describe('changement de role', () => {
    it('une promotion prend effet immediatement sur les droits', async () => {
      // Regression : le role etait ecrit sur la colonne vestigiale `user.role`
      // tandis que les controles d'acces lisaient `organization_member`. L'admin
      // croyait promouvoir quelqu'un sans qu'aucun droit ne change.
      expect((await creerChantier(employee.token)).statusCode).toBe(403);

      const promotion = await app.inject({
        method: 'PATCH',
        url: `/users/${employee.id}`,
        headers: auth(admin.token),
        payload: { role: 'admin' },
      });
      expect(promotion.statusCode).toBe(200);

      expect((await creerChantier(employee.token)).statusCode).toBe(201);
    });

    it('une retrogradation retire immediatement les droits', async () => {
      const cible = await createUser(app, { organizationId, role: 'admin' });
      expect((await creerChantier(cible.token)).statusCode).toBe(201);

      const retrogradation = await app.inject({
        method: 'PATCH',
        url: `/users/${cible.id}`,
        headers: auth(admin.token),
        payload: { role: 'employee' },
      });
      expect(retrogradation.statusCode).toBe(200);

      expect((await creerChantier(cible.token)).statusCode).toBe(403);
    });

    it('le role affiche sur la fiche est celui qui fait foi', async () => {
      // La liste joignait organization_member, la fiche lisait user.role : les
      // deux affichaient des roles differents pour la meme personne.
      await app.inject({
        method: 'PATCH',
        url: `/users/${employee.id}`,
        headers: auth(admin.token),
        payload: { role: 'manager' },
      });

      const fiche = await app.inject({
        method: 'GET',
        url: `/users/${employee.id}`,
        headers: auth(admin.token),
      });
      expect(fiche.json().role).toBe('manager');

      const moi = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: auth(await login(app, employee.email)),
      });
      expect(moi.json().role).toBe('manager');
    });

    it("l'organisation ne peut pas se retrouver sans aucun administrateur", async () => {
      // Sans garde-fou, l'unique admin peut se retrograder — et plus personne ne
      // peut inviter, gerer les comptes ni creer de chantier. L'API n'offre
      // aucune voie de retour.
      const res = await app.inject({
        method: 'PATCH',
        url: `/users/${admin.id}`,
        headers: auth(admin.token),
        payload: { role: 'employee' },
      });

      expect(res.statusCode).toBe(409);
      const restants = await app
        .db('organization_member')
        .where({ organization_id: organizationId, role: 'admin' })
        .count('* as n')
        .first();
      expect(Number(restants!.n)).toBeGreaterThan(0);
    });

    it("laisse un admin se retrograder tant qu'il en reste un autre", async () => {
      // Le garde-fou protege l'organisation, il n'immobilise pas les personnes.
      await createUser(app, { organizationId, role: 'admin' });

      const res = await app.inject({
        method: 'PATCH',
        url: `/users/${admin.id}`,
        headers: auth(admin.token),
        payload: { role: 'employee' },
      });

      expect(res.statusCode).toBe(200);
    });

    it("ne supprime pas le dernier administrateur", async () => {
      // Meme raisonnement que la retrogradation : une organisation sans admin
      // n'a plus aucun moyen de se gerer, et l'API n'offre pas de retour.
      const res = await app.inject({
        method: 'DELETE',
        url: `/users/${admin.id}`,
        headers: auth(admin.token),
      });

      expect(res.statusCode).toBe(409);
      expect(await app.db('user').where({ id: admin.id }).first()).toBeTruthy();
    });
  });

  describe('authentification', () => {
    it('une route protegee refuse une requete sans jeton', async () => {
      const res = await app.inject({ method: 'GET', url: '/chantiers' });
      expect(res.statusCode).toBe(401);
    });

    it('une route protegee refuse un jeton falsifie', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/chantiers',
        headers: auth('ceci.nest.pas-un-jeton'),
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
