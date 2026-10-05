import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, auth } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import { createOrgWithAdmin, createUser, type TestUser } from '../helpers/factories';

/**
 * Blocage : les messages et photos de la personne bloquee disparaissent pour
 * celui qui bloque, et pour lui seul. Personne d'autre ne voit rien changer.
 */
describe('Blocage', () => {
  let app: FastifyInstance;
  let organizationId: string;
  let admin: TestUser;
  let ouvrier: TestUser;
  let autre: TestUser;
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
    ouvrier = await createUser(app, { organizationId, role: 'employee' });
    autre = await createUser(app, { organizationId, role: 'employee' });
    chantierId = (await app.inject({ method: 'POST', url: '/chantiers', headers: auth(admin.token), payload: { name: 'Pont' } })).json().id;
    for (const u of [ouvrier, autre]) {
      await app.inject({ method: 'POST', url: '/chantier-members', headers: auth(admin.token), payload: { chantier_id: chantierId, user_id: u.id, role: 'ouvrier', can_edit: true } });
    }
    await app.inject({ method: 'POST', url: '/comments', headers: auth(ouvrier.token), payload: { chantier_id: chantierId, content: 'Message de l ouvrier' } });
    await app.inject({ method: 'POST', url: '/comments', headers: auth(admin.token), payload: { chantier_id: chantierId, content: 'Message de l admin' } });
    await app.inject({ method: 'POST', url: '/photos', headers: auth(ouvrier.token), payload: { chantier_id: chantierId, url: 'http://localhost:3000/files/o.jpg' } });
  });

  const bloquer = (token: string, userId: string) => app.inject({ method: 'POST', url: '/blocks', headers: auth(token), payload: { user_id: userId } });
  const messages = (token: string) => app.inject({ method: 'GET', url: `/comments?chantier_id=${chantierId}`, headers: auth(token) }).then((r) => r.json().data as { content: string }[]);
  const photos = (token: string) => app.inject({ method: 'GET', url: `/photos?chantier_id=${chantierId}`, headers: auth(token) }).then((r) => r.json().data as unknown[]);

  it("masque les messages et photos de la personne bloquee, pour moi seulement", async () => {
    expect((await bloquer(autre.token, ouvrier.id)).statusCode).toBe(201);

    expect((await messages(autre.token)).map((m) => m.content)).toEqual(['Message de l admin']);
    expect(await photos(autre.token)).toHaveLength(0);
    // L'admin, lui, voit tout.
    expect(await messages(admin.token)).toHaveLength(2);
    expect(await photos(admin.token)).toHaveLength(1);
  });

  it('debloquer rend tout', async () => {
    await bloquer(autre.token, ouvrier.id);

    const res = await app.inject({ method: 'DELETE', url: `/blocks/${ouvrier.id}`, headers: auth(autre.token) });

    expect(res.statusCode).toBe(204);
    expect(await messages(autre.token)).toHaveLength(2);
  });

  it("liste mes blocages, et le profil porte leurs identifiants", async () => {
    await bloquer(autre.token, ouvrier.id);

    const liste = await app.inject({ method: 'GET', url: '/blocks', headers: auth(autre.token) });
    const moi = await app.inject({ method: 'GET', url: '/auth/me', headers: auth(autre.token) });

    expect(liste.json().data).toHaveLength(1);
    expect(liste.json().data[0]).toMatchObject({ user_id: ouvrier.id, first_name: expect.any(String) });
    expect(moi.json().blocked_user_ids).toEqual([ouvrier.id]);
  });

  it("refuse de se bloquer soi-meme, et ne confirme pas un inconnu", async () => {
    expect((await bloquer(autre.token, autre.id)).statusCode).toBe(400);
    const beta = await createOrgWithAdmin(app, 'Beta BTP');
    expect((await bloquer(autre.token, beta.admin.id)).statusCode).toBe(404);
  });

  it('bloquer deux fois ne change rien', async () => {
    await bloquer(autre.token, ouvrier.id);
    expect((await bloquer(autre.token, ouvrier.id)).statusCode).toBe(201);
    expect(await app.db('user_block').where({ blocker_id: autre.id })).toHaveLength(1);
  });

  describe("fil d'une urgence", () => {
    let urgenceId: string;
    const fil = (token: string) =>
      app.inject({ method: 'GET', url: `/emergency-comments?emergency_id=${urgenceId}`, headers: auth(token) });

    beforeEach(async () => {
      urgenceId = (await app.inject({ method: 'POST', url: '/emergencies', headers: auth(admin.token), payload: { chantier_id: chantierId, description: 'Fuite de gaz' } })).json().id;
      for (const [token, content] of [[ouvrier.token, "Reponse de l'ouvrier"], [admin.token, "Reponse de l'admin"]] as const) {
        const res = await app.inject({ method: 'POST', url: '/emergency-comments', headers: auth(token), payload: { emergency_id: urgenceId, content } });
        expect(res.statusCode).toBe(201);
      }
    });

    it('masque les reponses de la personne bloquee, pour moi seulement', async () => {
      await bloquer(autre.token, ouvrier.id);

      const pourMoi = await fil(autre.token);
      expect(pourMoi.statusCode).toBe(200);
      expect(pourMoi.json().data.map((c: { content: string }) => c.content)).toEqual(["Reponse de l'admin"]);
      expect(pourMoi.json().meta.total).toBe(1);
      expect((await fil(admin.token)).json().data).toHaveLength(2);
      // La personne bloquee n'en sait rien : elle voit tout le fil.
      expect((await fil(ouvrier.token)).json().data).toHaveLength(2);
    });

    it('debloquer rend les reponses', async () => {
      await bloquer(autre.token, ouvrier.id);
      await app.inject({ method: 'DELETE', url: `/blocks/${ouvrier.id}`, headers: auth(autre.token) });

      expect((await fil(autre.token)).json().data).toHaveLength(2);
    });
  });

  // Une reponse d'un tiers a un message de la personne bloquee ne doit pas
  // embarquer la citation : le contenu bloque reviendrait par ce biais.
  it("ne laisse pas revenir un message bloque par la citation d'un tiers", async () => {
    const [cible] = (await app.inject({ method: 'GET', url: `/comments?chantier_id=${chantierId}`, headers: auth(admin.token) })).json().data
      .filter((c: { content: string }) => c.content === 'Message de l ouvrier');
    await app.inject({ method: 'POST', url: '/comments', headers: auth(admin.token), payload: { chantier_id: chantierId, content: 'Je reponds', reply_to_id: cible.id } });
    await bloquer(autre.token, ouvrier.id);

    const reponse = (await messages(autre.token)).find((m) => m.content === 'Je reponds') as unknown as { reply_to: { content: string } | null };

    expect(reponse.reply_to?.content).not.toBe('Message de l ouvrier');
  });
});
