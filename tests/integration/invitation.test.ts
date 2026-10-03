import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, auth } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import { createOrgWithAdmin, createUser, TEST_PASSWORD, type TestUser } from '../helpers/factories';

/**
 * Parcours d'invitation, de l'envoi a la creation du compte.
 *
 * C'est le chemin le plus retouche du projet et le seul par lequel un
 * collaborateur entre dans une organisation : s'il casse, plus personne ne peut
 * rejoindre l'entreprise. C'est aussi la seule route qui attribue un role sans
 * qu'un administrateur soit connecte au moment ou il est accorde.
 */
describe("Parcours d'invitation", () => {
  let app: FastifyInstance;
  let organizationId: string;
  let admin: TestUser;

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
  });

  /** Invite quelqu'un et renvoie le jeton lu en base. */
  async function inviter(params: { email: string; role?: string; locale?: string }): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/invitations',
      headers: auth(admin.token),
      payload: { email: params.email, role: params.role ?? 'employee', ...(params.locale ? { locale: params.locale } : {}) },
    });
    expect(res.statusCode).toBe(201);
    const row = await app.db('invitation').where({ email: params.email }).first();
    return row.token as string;
  }

  const inscrire = (jeton: string, extra: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: 'ignore@remplace-par-invitation.fr',
        password: 'MotDePasse123!',
        first_name: 'Arthur',
        last_name: 'Durand',
        phone: '0611223344',
        invitation_token: jeton,
        ...extra,
      },
    });

  it('cree une invitation en attente avec le role demande', async () => {
    await inviter({ email: 'arthur@alpha.fr', role: 'manager' });

    const row = await app.db('invitation').where({ email: 'arthur@alpha.fr' }).first();
    expect(row.status).toBe('pending');
    expect(row.role).toBe('manager');
    expect(row.organization_id).toBe(organizationId);
    expect(row.invited_by).toBe(admin.id);
    expect(new Date(row.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it("retient la langue choisie par celui qui invite", async () => {
    await inviter({ email: 'hans@alpha.fr', locale: 'de' });

    const row = await app.db('invitation').where({ email: 'hans@alpha.fr' }).first();
    expect(row.locale).toBe('de');
  });

  it('retombe sur le francais quand aucune langue n\'est precisee', async () => {
    await inviter({ email: 'sans-langue@alpha.fr' });

    const row = await app.db('invitation').where({ email: 'sans-langue@alpha.fr' }).first();
    expect(row.locale).toBe('fr');
  });

  it("expose l'email, le role et le nom de l'organisation pour prefixer le formulaire", async () => {
    const jeton = await inviter({ email: 'arthur@alpha.fr', role: 'client' });

    const res = await app.inject({ method: 'GET', url: `/invitations/by-token/${jeton}` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      email: 'arthur@alpha.fr',
      role: 'client',
      organization_name: 'Alpha TP',
    });
  });

  it("ne consomme pas l'invitation quand on se contente d'ouvrir le lien", async () => {
    // Regression : ouvrir le lien sans remplir le formulaire marquait
    // l'invitation comme acceptee. Au retour, l'invite lisait « lien invalide ».
    const jeton = await inviter({ email: 'arthur@alpha.fr' });

    await app.inject({ method: 'GET', url: `/invitations/by-token/${jeton}` });
    await app.inject({ method: 'GET', url: `/invitations/by-token/${jeton}` });

    const row = await app.db('invitation').where({ email: 'arthur@alpha.fr' }).first();
    expect(row.status).toBe('pending');

    expect((await inscrire(jeton)).statusCode).toBe(201);
  });

  it("rattache le nouveau compte a la bonne organisation avec le bon role", async () => {
    const jeton = await inviter({ email: 'arthur@alpha.fr', role: 'manager' });

    const res = await inscrire(jeton);
    expect(res.statusCode).toBe(201);

    const user = await app.db('user').where({ email: 'arthur@alpha.fr' }).first();
    expect(user).toBeTruthy();
    expect(user.active_organization_id).toBe(organizationId);

    const membership = await app
      .db('organization_member')
      .where({ user_id: user.id, organization_id: organizationId })
      .first();
    expect(membership.role).toBe('manager');
  });

  it("ignore l'email envoye par le formulaire au profit de celui de l'invitation", async () => {
    // Sinon n'importe qui recevant un lien pourrait s'inscrire sous une autre
    // adresse que celle invitee.
    const jeton = await inviter({ email: 'arthur@alpha.fr' });

    await inscrire(jeton, { email: 'attaquant@ailleurs.fr' });

    expect(await app.db('user').where({ email: 'attaquant@ailleurs.fr' }).first()).toBeUndefined();
    expect(await app.db('user').where({ email: 'arthur@alpha.fr' }).first()).toBeTruthy();
  });

  it("ignore le role demande par le formulaire au profit de celui de l'invitation", async () => {
    const jeton = await inviter({ email: 'arthur@alpha.fr', role: 'employee' });

    await inscrire(jeton, { role: 'admin' });

    const user = await app.db('user').where({ email: 'arthur@alpha.fr' }).first();
    const membership = await app.db('organization_member').where({ user_id: user.id }).first();
    expect(membership.role).toBe('employee');
  });

  it("donne au collaborateur la langue choisie par son employeur", async () => {
    const jeton = await inviter({ email: 'hans@alpha.fr', locale: 'de' });

    await inscrire(jeton);

    const user = await app.db('user').where({ email: 'hans@alpha.fr' }).first();
    expect(user.locale).toBe('de');
  });

  it("rend l'invitation inutilisable une fois le compte cree", async () => {
    const jeton = await inviter({ email: 'arthur@alpha.fr' });
    expect((await inscrire(jeton)).statusCode).toBe(201);

    const row = await app.db('invitation').where({ email: 'arthur@alpha.fr' }).first();
    expect(row.status).toBe('accepted');

    // Rejouer le meme lien ne doit pas creer un second compte.
    const rejeu = await inscrire(jeton, { email: 'autre@alpha.fr' });
    expect(rejeu.statusCode).not.toBe(201);
  });

  it('refuse une invitation expiree', async () => {
    const jeton = await inviter({ email: 'tardif@alpha.fr' });
    await app
      .db('invitation')
      .where({ email: 'tardif@alpha.fr' })
      .update({ expires_at: new Date(Date.now() - 24 * 3600 * 1000) });

    const consultation = await app.inject({ method: 'GET', url: `/invitations/by-token/${jeton}` });
    expect(consultation.statusCode).toBe(400);

    const inscription = await inscrire(jeton);
    expect(inscription.statusCode).toBe(400);
    expect(await app.db('user').where({ email: 'tardif@alpha.fr' }).first()).toBeUndefined();
  });

  it('refuse un jeton inconnu', async () => {
    const consultation = await app.inject({ method: 'GET', url: '/invitations/by-token/jeton-invente' });
    expect(consultation.statusCode).toBe(404);

    const inscription = await inscrire('jeton-invente');
    expect(inscription.statusCode).toBe(400);
  });

  it("permet a l'admin d'annuler une invitation de son organisation", async () => {
    await inviter({ email: 'annule@alpha.fr' });
    const row = await app.db('invitation').where({ email: 'annule@alpha.fr' }).first();

    const res = await app.inject({
      method: 'DELETE',
      url: `/invitations/${row.id}`,
      headers: auth(admin.token),
    });

    expect(res.statusCode).toBe(204);
    expect(await app.db('invitation').where({ id: row.id }).first()).toBeUndefined();
  });

  it("rend le lien inutilisable apres annulation", async () => {
    const jeton = await inviter({ email: 'annule@alpha.fr' });
    const row = await app.db('invitation').where({ email: 'annule@alpha.fr' }).first();
    await app.inject({ method: 'DELETE', url: `/invitations/${row.id}`, headers: auth(admin.token) });

    expect((await inscrire(jeton)).statusCode).toBe(400);
  });

  /**
   * Compte deja existant au moment de l'invitation.
   *
   * Cas reel : une salariee s'inscrit elle-meme en tapant le nom de son
   * entreprise, son patron l'invite une minute plus tard. Le lien repond
   * « adresse deja utilisee », l'invitation reste en attente, et elle est
   * invisible dans l'equipe. La connexion doit rattraper ce cas.
   */
  describe('compte deja existant', () => {
    const emmie = {
      email: 'emmie@alpha.fr',
      password: TEST_PASSWORD,
      first_name: 'Emmie',
      last_name: 'Martin',
      phone: '0611223344',
      company_name: 'Alpha TP',
    };

    const seConnecter = (email = emmie.email) =>
      app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: TEST_PASSWORD, platform: 'web' } });

    /** S'inscrit seule (coquille a son nom), puis est invitee. */
    async function inscriteAvantInvitation(role = 'employee') {
      const res = await app.inject({ method: 'POST', url: '/auth/register', payload: emmie });
      expect(res.statusCode).toBe(201);
      const coquilleId = res.json().user.active_organization_id as string;
      await inviter({ email: emmie.email, role });
      return coquilleId;
    }

    it("le lien d'invitation refuse une adresse qui a deja un compte", async () => {
      await inscriteAvantInvitation();
      const jeton = (await app.db('invitation').where({ email: emmie.email }).first()).token as string;

      expect((await inscrire(jeton)).statusCode).toBe(409);
    });

    it("rattache le compte a l'organisation invitante a la connexion", async () => {
      await inscriteAvantInvitation('manager');

      const res = await seConnecter();

      expect(res.statusCode).toBe(200);
      const membership = await app.db('organization_member')
        .where({ user_id: res.json().user.id, organization_id: organizationId })
        .first();
      expect(membership?.role).toBe('manager');
      expect((await app.db('invitation').where({ email: emmie.email }).first()).status).toBe('accepted');
    });

    it("bascule vers l'organisation invitante quand la sienne est une coquille vide", async () => {
      const coquilleId = await inscriteAvantInvitation();

      const res = await seConnecter();

      expect(res.json().user.active_organization_id).toBe(organizationId);
      // L'ancienne appartenance subsiste : rien n'est supprime a son insu.
      const orgs = (await app.db('organization_member').where({ user_id: res.json().user.id })).map(
        (m) => m.organization_id,
      );
      expect(orgs.sort()).toEqual([coquilleId, organizationId].sort());
    });

    it("garde son organisation active quand elle y a deja du travail", async () => {
      const coquilleId = await inscriteAvantInvitation();
      const userId = (await app.db('user').where({ email: emmie.email }).first()).id as string;
      await app.db('chantier').insert({ name: 'Mon chantier', organization_id: coquilleId, created_by: userId });

      const res = await seConnecter();

      expect(res.json().user.active_organization_id).toBe(coquilleId);
      expect(
        await app.db('organization_member').where({ user_id: userId, organization_id: organizationId }).first(),
      ).toBeDefined();
    });

    it("ignore la casse de l'adresse", async () => {
      await app.inject({ method: 'POST', url: '/auth/register', payload: { ...emmie, email: 'Emmie.Martin@alpha.fr' } });
      await inviter({ email: 'emmie.martin@alpha.fr' });

      const res = await seConnecter('Emmie.Martin@alpha.fr');

      expect(res.statusCode).toBe(200);
      expect(
        await app.db('organization_member').where({ user_id: res.json().user.id, organization_id: organizationId }).first(),
      ).toBeDefined();
    });

    it("n'honore pas une invitation expiree", async () => {
      await inscriteAvantInvitation();
      await app.db('invitation').where({ email: emmie.email }).update({ expires_at: new Date(Date.now() - 1000) });

      const res = await seConnecter();

      expect(res.statusCode).toBe(200);
      expect(
        await app.db('organization_member').where({ user_id: res.json().user.id, organization_id: organizationId }).first(),
      ).toBeUndefined();
      expect((await app.db('invitation').where({ email: emmie.email }).first()).status).toBe('pending');
    });

    it("entre dans l'equipe du manager qui l'a invitee", async () => {
      const manager = await createUser(app, { organizationId, role: 'manager' });
      await app.inject({ method: 'POST', url: '/auth/register', payload: emmie });
      const res = await app.inject({
        method: 'POST',
        url: '/invitations',
        headers: auth(manager.token),
        payload: { email: emmie.email, role: 'employee' },
      });
      expect(res.statusCode).toBe(201);

      const connexion = await seConnecter();

      expect(
        await app.db('team_member').where({ manager_id: manager.id, user_id: connexion.json().user.id }).first(),
      ).toBeDefined();
    });

    it("honore aussi l'invitation depuis /auth/me, pour un appareil reste connecte", async () => {
      // Connectee AVANT l'invitation : son jeton ne sait rien de celle-ci.
      await app.inject({ method: 'POST', url: '/auth/register', payload: emmie });
      const token = (await seConnecter()).json().access_token as string;
      await inviter({ email: emmie.email });

      const res = await app.inject({ method: 'GET', url: '/auth/me', headers: auth(token) });

      expect(res.statusCode).toBe(200);
      expect(res.json().active_organization_id).toBe(organizationId);
      expect(res.json().role).toBe('employee');
      expect(res.json().memberships.map((m: { organization_id: string }) => m.organization_id)).toContain(organizationId);
      expect((await app.db('invitation').where({ email: emmie.email }).first()).status).toBe('accepted');
    });

    it('ne refait rien a la connexion suivante', async () => {
      await inscriteAvantInvitation();
      await seConnecter();

      const res = await seConnecter();

      expect(res.statusCode).toBe(200);
      const memberships = await app.db('organization_member').where({ user_id: res.json().user.id });
      expect(memberships).toHaveLength(2);
    });
  });
});
