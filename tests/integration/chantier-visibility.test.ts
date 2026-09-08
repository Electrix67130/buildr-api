import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, auth } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import { createOrgWithAdmin, createUser, type TestUser } from '../helpers/factories';

/**
 * Qui voit quel chantier, a l'interieur d'une meme organisation.
 *
 * La regle : l'administrateur voit tout, les autres ne voient que les chantiers
 * ou ils ont ete places. Un ouvrier n'a pas a connaitre les adresses, les
 * clients ni les plannings des chantiers auxquels il ne participe pas.
 */
describe('Visibilite des chantiers', () => {
  let app: FastifyInstance;
  let organizationId: string;
  let admin: TestUser;
  let ouvrierAffecte: TestUser;
  let ouvrierEtranger: TestUser;
  let chantierId: string;

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
    ouvrierAffecte = await createUser(app, { organizationId, role: 'employee' });
    ouvrierEtranger = await createUser(app, { organizationId, role: 'employee' });

    const res = await app.inject({
      method: 'POST',
      url: '/chantiers',
      headers: auth(admin.token),
      payload: { name: 'Pont de la Loire', address: '1 quai des Ponts', city: 'Nantes' },
    });
    expect(res.statusCode).toBe(201);
    chantierId = res.json().id;

    const affectation = await app.inject({
      method: 'POST',
      url: '/chantier-members',
      headers: auth(admin.token),
      payload: { chantier_id: chantierId, user_id: ouvrierAffecte.id, role: 'ouvrier' },
    });
    expect(affectation.statusCode).toBe(201);
  });

  const listerPour = async (token: string) => {
    const res = await app.inject({ method: 'GET', url: '/chantiers', headers: auth(token) });
    expect(res.statusCode).toBe(200);
    return (res.json().data as { id: string }[]).map((c) => c.id);
  };

  it("l'administrateur voit tous les chantiers de son organisation", async () => {
    expect(await listerPour(admin.token)).toContain(chantierId);
  });

  it("l'ouvrier affecte voit son chantier", async () => {
    expect(await listerPour(ouvrierAffecte.token)).toContain(chantierId);
  });

  it("l'ouvrier non affecte ne voit pas le chantier", async () => {
    expect(await listerPour(ouvrierEtranger.token)).not.toContain(chantierId);
  });

  it("l'ouvrier non affecte ne peut pas ouvrir la fiche du chantier", async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/chantiers/${chantierId}`,
      headers: auth(ouvrierEtranger.token),
    });

    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('quai des Ponts');
  });

  it("l'ouvrier affecte peut ouvrir la fiche du chantier", async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/chantiers/${chantierId}`,
      headers: auth(ouvrierAffecte.token),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Pont de la Loire');
  });

  it("la recherche respecte la meme visibilite que la liste", async () => {
    // Sinon la recherche devient un contournement : le chantier masque dans la
    // liste ressort en tapant son nom.
    const res = await app.inject({
      method: 'GET',
      url: '/chantiers/search?q=Pont',
      headers: auth(ouvrierEtranger.token),
    });

    expect(res.statusCode).toBe(200);
    expect((res.json().data as { id: string }[]).map((c) => c.id)).not.toContain(chantierId);
  });

  it('le chef de chantier designe a la creation devient membre du chantier', async () => {
    const chef = await createUser(app, { organizationId, role: 'manager' });

    const res = await app.inject({
      method: 'POST',
      url: '/chantiers',
      headers: auth(admin.token),
      payload: { name: 'Rond-point sud', manager_id: chef.id },
    });
    expect(res.statusCode).toBe(201);

    const membre = await app
      .db('chantier_member')
      .where({ chantier_id: res.json().id, user_id: chef.id })
      .first();
    expect(membre).toBeTruthy();
    expect(membre.role).toBe('manager');
    expect(await listerPour(chef.token)).toContain(res.json().id);
  });

  it("n'affecte pas comme chef de chantier quelqu'un d'une autre organisation", async () => {
    const beta = await createOrgWithAdmin(app, 'Beta Constructions');

    const res = await app.inject({
      method: 'POST',
      url: '/chantiers',
      headers: auth(admin.token),
      payload: { name: 'Chantier infiltre', manager_id: beta.admin.id },
    });
    expect(res.statusCode).toBe(201);

    const membre = await app
      .db('chantier_member')
      .where({ chantier_id: res.json().id, user_id: beta.admin.id })
      .first();
    expect(membre).toBeUndefined();
  });

  describe('archivage', () => {
    it('un chantier archive quitte la liste active et rejoint les archives', async () => {
      const archivage = await app.inject({
        method: 'POST',
        url: `/chantiers/${chantierId}/archive`,
        headers: auth(admin.token),
      });
      expect(archivage.statusCode).toBe(200);

      expect(await listerPour(admin.token)).not.toContain(chantierId);

      const archives = await app.inject({ method: 'GET', url: '/chantiers/archives', headers: auth(admin.token) });
      expect((archives.json().data as { id: string }[]).map((c) => c.id)).toContain(chantierId);
    });

    it('le desarchivage remet le chantier dans la liste active', async () => {
      await app.inject({ method: 'POST', url: `/chantiers/${chantierId}/archive`, headers: auth(admin.token) });
      const retour = await app.inject({
        method: 'POST',
        url: `/chantiers/${chantierId}/unarchive`,
        headers: auth(admin.token),
      });
      expect(retour.statusCode).toBe(200);

      expect(await listerPour(admin.token)).toContain(chantierId);
    });
  });

  describe('filtrage par statut', () => {
    it('ne renvoie que les chantiers du statut demande', async () => {
      await app.inject({
        method: 'PATCH',
        url: `/chantiers/${chantierId}`,
        headers: auth(admin.token),
        payload: { status: 'en_cours' },
      });

      const enCours = await app.inject({
        method: 'GET',
        url: '/chantiers?status=en_cours',
        headers: auth(admin.token),
      });
      const aVenir = await app.inject({
        method: 'GET',
        url: '/chantiers?status=a_venir',
        headers: auth(admin.token),
      });

      expect((enCours.json().data as { id: string }[]).map((c) => c.id)).toContain(chantierId);
      expect((aVenir.json().data as { id: string }[]).map((c) => c.id)).not.toContain(chantierId);
    });
  });
});
