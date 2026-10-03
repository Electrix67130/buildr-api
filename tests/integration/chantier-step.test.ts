import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, auth } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import { createOrgWithAdmin, createUser, type TestUser } from '../helpers/factories';

/**
 * Etapes et sous-etapes de chantier.
 *
 * C'est le suivi d'avancement, donc le coeur du produit : ce que le client
 * regarde pour savoir ou en est son chantier, et ce sur quoi l'entreprise
 * s'appuie pour facturer. Qui peut valider quoi n'est pas un detail — une
 * etape validee par erreur avance un chantier sur le papier.
 */
describe('Etapes de chantier', () => {
  let app: FastifyInstance;
  let organizationId: string;
  let admin: TestUser;
  let chef: TestUser;
  let ouvrier: TestUser;
  let client: TestUser;
  let chantierId: string;
  let stepId: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const ajouterMembre = (user: TestUser, role: string, drapeaux: Record<string, boolean> = {}) =>
    app.inject({
      method: 'POST',
      url: '/chantier-members',
      headers: auth(admin.token),
      payload: { chantier_id: chantierId, user_id: user.id, role, ...drapeaux },
    });

  beforeEach(async () => {
    await truncateAll(app.db);
    const org = await createOrgWithAdmin(app, 'Alpha TP');
    organizationId = org.organizationId;
    admin = org.admin;
    chef = await createUser(app, { organizationId, role: 'manager' });
    ouvrier = await createUser(app, { organizationId, role: 'employee' });
    client = await createUser(app, { organizationId, role: 'client' });

    const chantier = await app.inject({
      method: 'POST',
      url: '/chantiers',
      headers: auth(admin.token),
      payload: { name: 'Pont de la Loire' },
    });
    chantierId = chantier.json().id;

    await ajouterMembre(chef, 'manager');
    await ajouterMembre(ouvrier, 'ouvrier');
    await ajouterMembre(client, 'client');

    const step = await app.inject({
      method: 'POST',
      url: '/chantier-steps',
      headers: auth(admin.token),
      payload: { chantier_id: chantierId, name: 'Fondations' },
    });
    stepId = step.json().id;
  });

  const creerEtape = (token: string, name = 'Terrassement') =>
    app.inject({
      method: 'POST',
      url: '/chantier-steps',
      headers: auth(token),
      payload: { chantier_id: chantierId, name },
    });

  const valider = (token: string, validated = true, comment?: string) =>
    app.inject({
      method: 'POST',
      url: `/chantier-steps/${stepId}/toggle`,
      headers: auth(token),
      payload: { validated, ...(comment ? { validation_comment: comment } : {}) },
    });

  describe('composition', () => {
    it.each([
      ['admin', () => admin],
      ['chef de chantier', () => chef],
    ])('un %s cree une etape', async (_label, get) => {
      expect((await creerEtape(get().token)).statusCode).toBe(201);
    });

    it.each([
      ['ouvrier', () => ouvrier],
      ['client', () => client],
    ])('un %s ne cree pas d etape', async (_label, get) => {
      expect((await creerEtape(get().token)).statusCode).toBe(403);
    });

    it('un ouvrier ne renomme pas une etape', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/chantier-steps/${stepId}`,
        headers: auth(ouvrier.token),
        payload: { name: 'Renomme par un ouvrier' },
      });

      expect(res.statusCode).toBe(403);
      expect((await app.db('chantier_step').where({ id: stepId }).first()).name).toBe('Fondations');
    });

    it('un ouvrier ne supprime pas une etape', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/chantier-steps/${stepId}`,
        headers: auth(ouvrier.token),
      });

      expect(res.statusCode).toBe(403);
      expect(await app.db('chantier_step').where({ id: stepId }).first()).toBeTruthy();
    });

    it("renvoie 404 pour une etape inexistante", async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/chantier-steps/00000000-0000-0000-0000-000000000000',
        headers: auth(admin.token),
        payload: { name: 'Fantome' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('validation', () => {
    it("l'ouvrier valide une etape, et la validation lui est attribuee", async () => {
      // C'est le geste quotidien sur le chantier : c'est celui qui fait le
      // travail qui le declare fait.
      const res = await valider(ouvrier.token, true, 'Coule ce matin');

      expect(res.statusCode).toBe(200);
      // La validation s'exprime par une date, pas par un booleen : elle dit
      // aussi QUAND l'etape a ete declaree faite.
      const step = await app.db('chantier_step').where({ id: stepId }).first();
      expect(step.validated_at).toBeTruthy();
      expect(step.validated_by).toBe(ouvrier.id);
      expect(step.validation_comment).toBe('Coule ce matin');
    });

    it("le client ne valide pas l'avancement", async () => {
      // Il regarde le chantier, il ne le fait pas avancer.
      const res = await valider(client.token);

      expect(res.statusCode).toBe(403);
      expect((await app.db('chantier_step').where({ id: stepId }).first()).validated_at).toBeNull();
    });

    it('une etape peut etre devalidee, et cesse alors d etre attribuee', async () => {
      await valider(ouvrier.token, true);

      const res = await valider(chef.token, false);

      expect(res.statusCode).toBe(200);
      const step = await app.db('chantier_step').where({ id: stepId }).first();
      expect(step.validated_at).toBeNull();
      expect(step.validated_by).toBeNull();
    });

    it('une sous-etape se valide independamment', async () => {
      const sous = await app.inject({
        method: 'POST',
        url: '/chantier-substeps',
        headers: auth(admin.token),
        payload: { step_id: stepId, name: 'Coffrage' },
      });
      expect(sous.statusCode).toBe(201);

      const res = await app.inject({
        method: 'POST',
        url: `/chantier-substeps/${sous.json().id}/toggle`,
        headers: auth(ouvrier.token),
        payload: { validated: true },
      });

      expect(res.statusCode).toBe(200);
      expect((await app.db('chantier_substep').where({ id: sous.json().id }).first()).validated_at).toBeTruthy();
    });
  });

  describe('consultation', () => {
    it("un membre autorise voit les etapes", async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/chantiers/${chantierId}/steps`,
        headers: auth(ouvrier.token),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(1);
    });

    it("un membre dont le drapeau est ferme ne les voit pas", async () => {
      const exclu = await createUser(app, { organizationId, role: 'employee' });
      await ajouterMembre(exclu, 'ouvrier', { can_view_steps: false });

      const res = await app.inject({
        method: 'GET',
        url: `/chantiers/${chantierId}/steps`,
        headers: auth(exclu.token),
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('ordre', () => {
    it('se reordonne, et l ordre est conserve', async () => {
      // L'ordre des etapes raconte le deroulement du chantier : le melanger
      // rend le suivi illisible.
      const deuxieme = await creerEtape(admin.token, 'Elevation');

      const res = await app.inject({
        method: 'POST',
        url: `/chantiers/${chantierId}/steps/reorder`,
        headers: auth(admin.token),
        payload: { ordered_ids: [deuxieme.json().id, stepId] },
      });
      expect(res.statusCode).toBe(204);

      const liste = await app.inject({
        method: 'GET',
        url: `/chantiers/${chantierId}/steps`,
        headers: auth(admin.token),
      });
      expect(liste.json().map((s: { name: string }) => s.name)).toEqual(['Elevation', 'Fondations']);
    });

    it("un ouvrier ne reordonne pas les etapes", async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/chantiers/${chantierId}/steps/reorder`,
        headers: auth(ouvrier.token),
        payload: { ordered_ids: [stepId] },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('cloisonnement entre organisations', () => {
    let beta: { organizationId: string; admin: TestUser };

    beforeEach(async () => {
      beta = await createOrgWithAdmin(app, 'Beta Constructions');
    });

    it("les etapes d'un chantier d'une autre organisation ne sont pas lisibles", async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/chantiers/${chantierId}/steps`,
        headers: auth(beta.admin.token),
      });

      expect(res.statusCode).not.toBe(200);
      expect(res.body).not.toContain('Fondations');
    });

    it("on ne cree pas d'etape sur le chantier d'une autre organisation", async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/chantier-steps',
        headers: auth(beta.admin.token),
        payload: { chantier_id: chantierId, name: 'Etape intruse' },
      });

      expect(res.statusCode).toBe(403);
    });

    it("on ne valide pas l'avancement du chantier d'une autre organisation", async () => {
      // Le cas le plus couteux : une entreprise ferait avancer le chantier
      // d'une autre, sur lequel elle pourrait facturer.
      const res = await valider(beta.admin.token);

      expect(res.statusCode).toBe(403);
      expect((await app.db('chantier_step').where({ id: stepId }).first()).validated_at).toBeNull();
    });

    it("on ne supprime pas l'etape du chantier d'une autre organisation", async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/chantier-steps/${stepId}`,
        headers: auth(beta.admin.token),
      });

      expect(res.statusCode).not.toBe(204);
      expect(await app.db('chantier_step').where({ id: stepId }).first()).toBeTruthy();
    });
  });

  /**
   * Photos rattachees aux etapes.
   *
   * Valider une etape, c'est constater un etat ; la photo en est la preuve.
   * Elle doit apparaitre sur l'etape qu'elle atteste, rester une photo du
   * chantier comme les autres, et ne jamais pouvoir s'accrocher a l'etape
   * d'un autre chantier.
   */
  describe("photos d'etape", () => {
    const poster = (payload: Record<string, unknown>, token = admin.token) =>
      app.inject({ method: 'POST', url: '/photos', headers: auth(token), payload: { chantier_id: chantierId, url: 'http://localhost:3000/files/p.jpg', ...payload } });
    const etapes = () => app.inject({ method: 'GET', url: `/chantiers/${chantierId}/steps`, headers: auth(admin.token) }).then((r) => r.json());

    it("une photo de sous-etape apparait sur elle, et porte aussi son etape", async () => {
      const sub = (await app.inject({ method: 'POST', url: '/chantier-substeps', headers: auth(admin.token), payload: { step_id: stepId, name: 'Coffrage' } })).json();

      const res = await poster({ substep_id: sub.id });

      expect(res.statusCode).toBe(201);
      expect(res.json().step_id).toBe(stepId);
      const [step] = await etapes();
      expect(step.photos).toHaveLength(0);
      expect(step.substeps[0].photos.map((p: { id: string }) => p.id)).toEqual([res.json().id]);
    });

    it("une photo d'etape apparait sur l'etape", async () => {
      const res = await poster({ step_id: stepId });

      expect(res.statusCode).toBe(201);
      const [step] = await etapes();
      expect(step.photos.map((p: { id: string }) => p.id)).toEqual([res.json().id]);
    });

    it("refuse l'etape d'un autre chantier", async () => {
      const autre = (await app.inject({ method: 'POST', url: '/chantiers', headers: auth(admin.token), payload: { name: 'Autre' } })).json();
      const etapeAilleurs = (await app.inject({ method: 'POST', url: '/chantier-steps', headers: auth(admin.token), payload: { chantier_id: autre.id, name: 'X' } })).json();

      expect((await poster({ step_id: etapeAilleurs.id })).statusCode).toBe(400);
    });

    it("la galerie sait filtrer par etape", async () => {
      await poster({ step_id: stepId });
      await poster({});

      const tout = await app.inject({ method: 'GET', url: `/photos?chantier_id=${chantierId}`, headers: auth(admin.token) });
      const filtre = await app.inject({ method: 'GET', url: `/photos?chantier_id=${chantierId}&step_id=${stepId}`, headers: auth(admin.token) });

      expect(tout.json().meta.total).toBe(2);
      expect(filtre.json().meta.total).toBe(1);
    });

    it("supprimer l'etape detache la photo sans la perdre", async () => {
      const photo = (await poster({ step_id: stepId })).json();

      await app.inject({ method: 'DELETE', url: `/chantier-steps/${stepId}`, headers: auth(admin.token) });

      const row = await app.db('photo').where({ id: photo.id }).first();
      expect(row).toBeDefined();
      expect(row.step_id).toBeNull();
    });
  });

  /**
   * Un administrateur de l'organisation a toujours tout sur ses chantiers :
   * ses drapeaux de membre ne sont jamais lus. Les laisser modifiables
   * faisait croire qu'on pouvait le restreindre.
   */
  describe("permissions d'un administrateur", () => {
    it("la liste des membres donne le role dans l'organisation du chantier", async () => {
      await ajouterMembre(admin, 'manager');

      const res = await app.inject({ method: 'GET', url: `/chantier-members/by-chantier?chantier_id=${chantierId}`, headers: auth(admin.token) });

      const roles = Object.fromEntries(res.json().data.map((m: { user_id: string; user_role: string }) => [m.user_id, m.user_role]));
      expect(roles[admin.id]).toBe('admin');
      expect(roles[ouvrier.id]).toBe('employee');
      expect(roles[chef.id]).toBe('manager');
    });

    it("refuse de modifier les permissions d'un administrateur", async () => {
      await ajouterMembre(admin, 'ouvrier');
      const lien = await app.db('chantier_member').where({ chantier_id: chantierId, user_id: admin.id }).first();

      const res = await app.inject({ method: 'PATCH', url: `/chantier-members/${lien.id}`, headers: auth(admin.token), payload: { can_view_photos: false } });

      expect(res.statusCode).toBe(409);
      expect((await app.db('chantier_member').where({ id: lien.id }).first()).can_view_photos).toBe(true);
    });

    it("modifie toujours celles d'un ouvrier", async () => {
      const lien = await app.db('chantier_member').where({ chantier_id: chantierId, user_id: ouvrier.id }).first();

      const res = await app.inject({ method: 'PATCH', url: `/chantier-members/${lien.id}`, headers: auth(admin.token), payload: { can_view_photos: false } });

      expect(res.statusCode).toBe(200);
    });
  });
});
