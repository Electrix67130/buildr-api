import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import type { FastifyInstance } from 'fastify';
import { createTestApp, auth } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import { createOrgWithAdmin, createUser, login, TEST_PASSWORD, type TestUser } from '../helpers/factories';

/**
 * Authentification : inscription, connexion, sessions, mot de passe oublie.
 *
 * Tout le reste de l'API repose sur ce module. Une session mal invalidee laisse
 * un appareil perdu connecte ; un message d'erreur trop bavard sur le mot de
 * passe oublie transforme l'API en annuaire d'adresses valides.
 */
describe('Authentification', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(app.db);
  });

  const inscription = {
    email: 'patronne@alpha.fr',
    password: TEST_PASSWORD,
    first_name: 'Marie',
    last_name: 'Dupont',
    phone: '0611223344',
    company_name: 'Alpha TP',
  };

  const sinscrire = (extra: Record<string, unknown> = {}) =>
    app.inject({ method: 'POST', url: '/auth/register', payload: { ...inscription, ...extra } });

  describe('inscription', () => {
    it("cree l'organisation et fait de l'inscrit son administrateur", () => sinscrire().then(async (res) => {
      expect(res.statusCode).toBe(201);

      const user = await app.db('user').where({ email: inscription.email }).first();
      const org = await app.db('organization').where({ name: 'Alpha TP' }).first();
      expect(org).toBeTruthy();
      expect(user.active_organization_id).toBe(org.id);

      const membership = await app.db('organization_member').where({ user_id: user.id }).first();
      expect(membership.role).toBe('admin');
      expect(membership.organization_id).toBe(org.id);
    }));

    it('renvoie une session utilisable immediatement', async () => {
      const res = await sinscrire();
      const { access_token, refresh_token } = res.json();

      expect(refresh_token).toBeTruthy();
      const moi = await app.inject({ method: 'GET', url: '/auth/me', headers: auth(access_token) });
      expect(moi.statusCode).toBe(200);
      expect(moi.json().email).toBe(inscription.email);
    });

    it("ne divulgue jamais le mot de passe hache", async () => {
      const res = await sinscrire();
      expect(res.body).not.toContain('password_hash');
      expect(res.body).not.toContain('$2b$');
    });

    it('refuse une adresse deja utilisee', async () => {
      expect((await sinscrire()).statusCode).toBe(201);
      expect((await sinscrire()).statusCode).toBe(409);
      const comptes = await app.db('user').where({ email: inscription.email }).count('* as n').first();
      expect(Number(comptes!.n)).toBe(1);
    });

    it("enregistre l'adresse en minuscules, quelle que soit la saisie", async () => {
      const res = await sinscrire({ email: ' Patronne@Alpha.FR ' });

      expect(res.statusCode).toBe(201);
      expect(res.json().user.email).toBe('patronne@alpha.fr');
      expect(await app.db('user').where({ email: 'patronne@alpha.fr' }).first()).toBeDefined();
    });

    it('refuse une adresse deja utilisee, a la casse pres', async () => {
      // Le cas reel : un compte cree seul en minuscules, puis une seconde
      // inscription avec la majuscule que le telephone avait ajoutee.
      expect((await sinscrire()).statusCode).toBe(201);
      expect((await sinscrire({ email: 'Patronne@alpha.fr' })).statusCode).toBe(409);
      const comptes = await app.db('user').whereRaw('lower(email) = ?', [inscription.email]).count('* as n').first();
      expect(Number(comptes!.n)).toBe(1);
    });

    it("designe l'inscrit comme createur de son organisation", async () => {
      await sinscrire();
      const user = await app.db('user').where({ email: inscription.email }).first();
      const org = await app.db('organization').where({ id: user.active_organization_id }).first();
      expect(org.created_by).toBe(user.id);
    });

    it("nomme l'organisation d'apres la personne quand aucune societe n'est donnee", async () => {
      await sinscrire({ company_name: undefined });
      expect(await app.db('organization').where({ name: 'Marie Dupont' }).first()).toBeTruthy();
    });

    it('enregistre les telephones en E.164, quelle que soit la saisie', async () => {
      // Avant, la colonne recevait la saisie telle quelle : `06 11 22 33 44`,
      // `0611223344` et `06.11.22.33.44` cohabitaient pour un meme numero.
      const res = await sinscrire({
        phone: '06 11 22 33 44',
        organization: { phone: '03.29.00.00.00', country: 'FR' },
      });
      expect(res.statusCode).toBe(201);

      const user = await app.db('user').where({ email: inscription.email }).first();
      expect(user.phone).toBe('+33611223344');
      const org = await app.db('organization').where({ id: user.active_organization_id }).first();
      expect(org.phone).toBe('+33329000000');
    });

    it("lit un numero sans indicatif avec le pays de l'organisation", async () => {
      const res = await sinscrire({ phone: '0151 23456789', organization: { country: 'DE' } });
      expect(res.statusCode).toBe(201);
      const user = await app.db('user').where({ email: inscription.email }).first();
      expect(user.phone).toBe('+4915123456789');
    });

    it("refuse un telephone qui n'en est pas un", async () => {
      expect((await sinscrire({ phone: 'bonjour' })).statusCode).toBe(400);
      // Bonne forme mais pas un numero : c'est le service, pas Zod, qui tranche.
      expect((await sinscrire({ phone: '01 23 45' })).statusCode).toBe(400);
      expect(await app.db('user').where({ email: inscription.email }).first()).toBeUndefined();
    });
  });

  describe('connexion', () => {
    beforeEach(async () => {
      await sinscrire();
    });

    it("accepte l'adresse quelle que soit sa casse", async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'PATRONNE@Alpha.fr', password: TEST_PASSWORD },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().user.email).toBe(inscription.email);
    });

    it('refuse un mot de passe errone', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: inscription.email, password: 'MauvaisMotDePasse1' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('donne la meme reponse pour un compte inexistant que pour un mot de passe errone', async () => {
      // Sinon l'ecart de reponse revele quelles adresses ont un compte.
      const inconnu = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'personne@nulle-part.fr', password: 'MauvaisMotDePasse1' },
      });
      const mauvais = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: inscription.email, password: 'MauvaisMotDePasse1' },
      });

      expect(inconnu.statusCode).toBe(mauvais.statusCode);
      expect(inconnu.json().message).toBe(mauvais.json().message);
    });

    it("refuse un compte desactive, et le dit quand le mot de passe est le bon", async () => {
      await app.db('user').where({ email: inscription.email }).update({ is_active: false });

      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: inscription.email, password: TEST_PASSWORD },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('AccountDisabled');
    });

    it("ne revele pas qu'un compte desactive existe sans le bon mot de passe", async () => {
      await app.db('user').where({ email: inscription.email }).update({ is_active: false });

      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: inscription.email, password: 'faux-mot-de-passe' },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  /**
   * Desactiver un compte doit le deconnecter tout de suite, partout. Sans
   * cela, l'ecran qu'il avait sous les yeux restait utilisable un quart
   * d'heure, le temps que son jeton d'acces expire.
   */
  describe('desactivation par un administrateur', () => {
    it("coupe la session en cours et le renouvellement", async () => {
      const { organizationId, admin } = await createOrgWithAdmin(app, 'Alpha TP');
      const employe = await createUser(app, { organizationId, role: 'employee' });
      const session = (await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: employe.email, password: TEST_PASSWORD, platform: 'mobile' },
      })).json();
      expect((await app.inject({ method: 'GET', url: '/auth/me', headers: auth(session.access_token) })).statusCode).toBe(200);

      const res = await app.inject({
        method: 'PATCH',
        url: `/users/${employe.id}`,
        headers: auth(admin.token),
        payload: { is_active: false },
      });
      expect(res.statusCode).toBe(200);

      expect((await app.inject({ method: 'GET', url: '/auth/me', headers: auth(session.access_token) })).statusCode).toBe(401);
      const refresh = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refresh_token: session.refresh_token } });
      expect(refresh.statusCode).toBe(401);
    });
  });

  describe('sessions par plateforme', () => {
    beforeEach(async () => {
      await sinscrire();
    });

    const seConnecter = async (platform: 'web' | 'mobile') => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: inscription.email, password: TEST_PASSWORD, platform },
      });
      expect(res.statusCode).toBe(200);
      return res.json();
    };

    const verifierJeton = (token: string) =>
      app.inject({ method: 'GET', url: '/auth/me', headers: auth(token) }).then((r) => r.statusCode);

    it('une nouvelle connexion chasse la precedente sur la meme plateforme', async () => {
      const premier = await seConnecter('web');
      expect(await verifierJeton(premier.access_token)).toBe(200);

      const second = await seConnecter('web');

      expect(await verifierJeton(premier.access_token)).toBe(401);
      expect(await verifierJeton(second.access_token)).toBe(200);
    });

    it("se connecter sur le mobile ne deconnecte pas le dashboard", async () => {
      // C'est l'usage reel : l'app sur le chantier, le dashboard au bureau.
      const web = await seConnecter('web');
      const mobile = await seConnecter('mobile');

      expect(await verifierJeton(web.access_token)).toBe(200);
      expect(await verifierJeton(mobile.access_token)).toBe(200);
    });

    it('la deconnexion ne coupe que la plateforme dont vient le jeton', async () => {
      const web = await seConnecter('web');
      const mobile = await seConnecter('mobile');

      const res = await app.inject({ method: 'POST', url: '/auth/logout', headers: auth(web.access_token) });
      expect(res.statusCode).toBe(204);

      expect(await verifierJeton(web.access_token)).toBe(401);
      expect(await verifierJeton(mobile.access_token)).toBe(200);
    });
  });

  describe('renouvellement de jeton', () => {
    beforeEach(async () => {
      await sinscrire();
    });

    it('echange un jeton de rafraichissement contre une nouvelle session', async () => {
      const { refresh_token } = (await sinscrire({ email: 'autre@alpha.fr' })).json();

      const res = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refresh_token } });

      expect(res.statusCode).toBe(200);
      const moi = await app.inject({ method: 'GET', url: '/auth/me', headers: auth(res.json().access_token) });
      expect(moi.statusCode).toBe(200);
    });

    it("un jeton deja echange redonne la session en cours pendant la tolerance", async () => {
      // Reponse perdue : le telephone rejoue l'ancien jeton. Il doit retrouver
      // LA session en cours, pas en obtenir une seconde.
      const { refresh_token } = (await sinscrire({ email: 'autre@alpha.fr' })).json();
      const premier = (await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refresh_token } })).json();

      const rejeu = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refresh_token } });

      expect(rejeu.statusCode).toBe(200);
      expect(rejeu.json().refresh_token).toBe(premier.refresh_token);
      // Les deux jetons d'acces portent la meme session : aucun des deux n'a chasse l'autre.
      for (const token of [premier.access_token, rejeu.json().access_token]) {
        expect((await app.inject({ method: 'GET', url: '/auth/me', headers: auth(token) })).statusCode).toBe(200);
      }
    });

    it('refuse un jeton remplace une fois la tolerance passee', async () => {
      const { refresh_token } = (await sinscrire({ email: 'autre@alpha.fr' })).json();
      await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refresh_token } });
      await app.db('refresh_token').where({ token: refresh_token }).update({ replaced_at: new Date(Date.now() - 2 * 60_000) });

      const rejeu = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refresh_token } });

      expect(rejeu.statusCode).toBe(401);
    });

    it("refuse un jeton remplace si la session en cours a ete fermee entre-temps", async () => {
      const { refresh_token } = (await sinscrire({ email: 'autre@alpha.fr' })).json();
      const premier = (await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refresh_token } })).json();
      await app.inject({ method: 'POST', url: '/auth/logout', headers: auth(premier.access_token) });

      const rejeu = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refresh_token } });

      expect(rejeu.statusCode).toBe(401);
    });

    it('refuse un jeton inutilise depuis plus de 90 jours', async () => {
      const { refresh_token } = (await sinscrire({ email: 'autre@alpha.fr' })).json();
      await app.db('refresh_token').where({ token: refresh_token }).update({ created_at: new Date(Date.now() - 91 * 24 * 3600_000) });

      const res = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refresh_token } });

      expect(res.statusCode).toBe(401);
      expect(await app.db('refresh_token').where({ token: refresh_token }).first()).toBeUndefined();
    });

    it('une connexion neuve balaie les jetons remplaces en attente', async () => {
      const { refresh_token } = (await sinscrire({ email: 'autre@alpha.fr' })).json();
      await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refresh_token } });
      await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'autre@alpha.fr', password: TEST_PASSWORD } });

      const rejeu = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refresh_token } });

      expect(rejeu.statusCode).toBe(401);
    });

    it('refuse un jeton de rafraichissement invente', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refresh_token: '00000000-0000-0000-0000-000000000000' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('mot de passe oublie', () => {
    beforeEach(async () => {
      await sinscrire();
    });

    it("ne revele pas si l'adresse a un compte", async () => {
      const connue = await app.inject({
        method: 'POST',
        url: '/auth/forgot-password',
        payload: { email: inscription.email },
      });
      const inconnue = await app.inject({
        method: 'POST',
        url: '/auth/forgot-password',
        payload: { email: 'personne@nulle-part.fr' },
      });

      expect(connue.statusCode).toBe(inconnue.statusCode);
      expect(connue.json().message).toBe(inconnue.json().message);
    });

    /** Reconstruit le jeton comme le fait le service, pour eprouver sa verification. */
    const jetonReset = (userId: string, expires: number) => {
      const signature = createHmac('sha256', process.env.JWT_SECRET!).update(`${userId}:${expires}`).digest('hex');
      return Buffer.from(JSON.stringify({ u: userId, e: expires, s: signature })).toString('base64url');
    };

    it('accepte un jeton valide et change le mot de passe', async () => {
      const user = await app.db('user').where({ email: inscription.email }).first();
      const jeton = jetonReset(user.id, Date.now() + 30 * 60 * 1000);

      const res = await app.inject({
        method: 'POST',
        url: '/auth/reset-password',
        payload: { token: jeton, new_password: 'NouveauMotDePasse1' },
      });
      expect(res.statusCode).toBe(200);

      const connexion = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: inscription.email, password: 'NouveauMotDePasse1' },
      });
      expect(connexion.statusCode).toBe(200);
    });

    it('refuse un jeton dont la signature a ete falsifiee', async () => {
      const user = await app.db('user').where({ email: inscription.email }).first();
      const valide = jetonReset(user.id, Date.now() + 30 * 60 * 1000);
      const decode = JSON.parse(Buffer.from(valide, 'base64url').toString());

      // Meme signature, autre utilisateur : le jeton d'un compte ne doit pas
      // servir a reinitialiser celui d'un autre.
      const autre = await createUser(app, { organizationId: user.active_organization_id, role: 'employee' });
      const detourne = Buffer.from(JSON.stringify({ ...decode, u: autre.id })).toString('base64url');

      const res = await app.inject({
        method: 'POST',
        url: '/auth/reset-password',
        payload: { token: detourne, new_password: 'NouveauMotDePasse1' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('refuse un jeton perime', async () => {
      const user = await app.db('user').where({ email: inscription.email }).first();
      const perime = jetonReset(user.id, Date.now() - 1000);

      const res = await app.inject({
        method: 'POST',
        url: '/auth/reset-password',
        payload: { token: perime, new_password: 'NouveauMotDePasse1' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('refuse un jeton illisible', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/reset-password',
        payload: { token: 'ceci-nest-pas-un-jeton', new_password: 'NouveauMotDePasse1' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('changement de mot de passe', () => {
    let compte: { access_token: string; refresh_token: string };

    beforeEach(async () => {
      compte = (await sinscrire()).json();
    });

    it('exige le mot de passe actuel', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/password',
        headers: auth(compte.access_token),
        payload: { current_password: 'MauvaisMotDePasse1', new_password: 'NouveauMotDePasse1' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('revoque les jetons de rafraichissement des autres appareils', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/password',
        headers: auth(compte.access_token),
        payload: { current_password: TEST_PASSWORD, new_password: 'NouveauMotDePasse1' },
      });
      expect(res.statusCode).toBe(200);

      const rejeu = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refresh_token: compte.refresh_token },
      });
      expect(rejeu.statusCode).toBe(401);
    });
  });

  describe('organisation active', () => {
    let alpha: { organizationId: string; admin: TestUser };

    beforeEach(async () => {
      alpha = await createOrgWithAdmin(app, 'Alpha TP');
    });

    it("refuse de basculer vers une organisation dont on n'est pas membre", async () => {
      const beta = await createOrgWithAdmin(app, 'Beta Constructions');

      const res = await app.inject({
        method: 'POST',
        url: '/auth/switch-organization',
        headers: auth(alpha.admin.token),
        payload: { organization_id: beta.organizationId },
      });

      expect(res.statusCode).toBe(403);
      const user = await app.db('user').where({ id: alpha.admin.id }).first();
      expect(user.active_organization_id).toBe(alpha.organizationId);
    });

    it('bascule vers une organisation dont on est membre et applique le role de celle-ci', async () => {
      const beta = await createOrgWithAdmin(app, 'Beta Constructions');
      await app.db('organization_member').insert({
        organization_id: beta.organizationId,
        user_id: alpha.admin.id,
        role: 'employee',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/auth/switch-organization',
        headers: auth(alpha.admin.token),
        payload: { organization_id: beta.organizationId },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().role).toBe('employee');

      const moi = await app.inject({ method: 'GET', url: '/auth/me', headers: auth(alpha.admin.token) });
      expect(moi.json().role).toBe('employee');
      expect(moi.json().organization_id).toBe(beta.organizationId);
    });

    it('expose la liste des organisations rejointes', async () => {
      const beta = await createOrgWithAdmin(app, 'Beta Constructions');
      await app.db('organization_member').insert({
        organization_id: beta.organizationId,
        user_id: alpha.admin.id,
        role: 'employee',
      });

      const moi = await app.inject({ method: 'GET', url: '/auth/me', headers: auth(alpha.admin.token) });

      expect(moi.json().memberships).toHaveLength(2);
    });
  });

  describe('langue des e-mails', () => {
    it("retient la langue choisie a l'inscription", async () => {
      await sinscrire({ locale: 'pt' });
      const user = await app.db('user').where({ email: inscription.email }).first();
      expect(user.locale).toBe('pt');
    });

    it('permet de changer la langue de ses e-mails', async () => {
      // Sans cela, qui change la langue de l'application continue de recevoir
      // ses e-mails en francais, sans aucun moyen de le corriger.
      const { organizationId } = await createOrgWithAdmin(app, 'Alpha TP');
      const membre = await createUser(app, { organizationId, role: 'employee', locale: 'fr' });

      const res = await app.inject({
        method: 'PATCH',
        url: `/users/${membre.id}`,
        headers: auth(membre.token),
        payload: { locale: 'de' },
      });
      expect(res.statusCode).toBe(200);

      const user = await app.db('user').where({ id: membre.id }).first();
      expect(user.locale).toBe('de');
    });
  });
});
