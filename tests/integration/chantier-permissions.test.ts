import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, auth } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import { createOrgWithAdmin, createUser, type TestUser } from '../helpers/factories';

/**
 * Droits fins a l'interieur d'un chantier.
 *
 * Chaque membre d'un chantier porte cinq drapeaux de lecture et un d'ecriture.
 * Ils servent notamment aux clients et aux prestataires : on ouvre la galerie
 * photos a un client sans lui donner les documents contractuels, ni les
 * discussions internes de l'equipe.
 *
 * Le contournement redoute est toujours le meme : lire par une autre route ce
 * qu'un drapeau interdit. D'ou les tests par ressource, et pas seulement sur la
 * fonction de permission.
 */
describe('Permissions par chantier', () => {
  let app: FastifyInstance;
  let organizationId: string;
  let admin: TestUser;
  let createur: TestUser;
  let ouvrier: TestUser;
  let chantierId: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Ajoute un membre au chantier avec les drapeaux demandes. */
  const ajouterMembre = (user: TestUser, drapeaux: Record<string, boolean>) =>
    app.inject({
      method: 'POST',
      url: '/chantier-members',
      headers: auth(admin.token),
      payload: {
        chantier_id: chantierId,
        user_id: user.id,
        role: 'ouvrier',
        can_view_comments: false,
        can_view_photos: false,
        can_view_documents: false,
        can_view_steps: false,
        can_view_team: false,
        can_edit: false,
        ...drapeaux,
      },
    });

  beforeEach(async () => {
    await truncateAll(app.db);
    const org = await createOrgWithAdmin(app, 'Alpha TP');
    organizationId = org.organizationId;
    admin = org.admin;
    createur = await createUser(app, { organizationId, role: 'manager' });
    ouvrier = await createUser(app, { organizationId, role: 'employee' });

    const res = await app.inject({
      method: 'POST',
      url: '/chantiers',
      headers: auth(admin.token),
      payload: { name: 'Pont de la Loire', manager_id: createur.id },
    });
    chantierId = res.json().id;

    // Contenu depose par l'admin, que les drapeaux vont proteger ou non.
    await app.inject({
      method: 'POST',
      url: '/photos',
      headers: auth(admin.token),
      payload: { chantier_id: chantierId, url: 'http://localhost:3000/files/photo-1.jpg' },
    });
    await app.inject({
      method: 'POST',
      url: '/documents',
      headers: auth(admin.token),
      payload: {
        chantier_id: chantierId,
        name: 'Contrat confidentiel.pdf',
        type: 'autre',
        url: 'http://localhost:3000/files/contrat.pdf',
      },
    });
    await app.inject({
      method: 'POST',
      url: '/comments',
      headers: auth(admin.token),
      payload: { chantier_id: chantierId, content: 'Discussion interne de l equipe' },
    });
  });

  const lire = (ressource: string, token: string) =>
    app.inject({ method: 'GET', url: `/${ressource}?chantier_id=${chantierId}`, headers: auth(token) });

  describe('un membre sans aucun droit de lecture', () => {
    beforeEach(async () => {
      await ajouterMembre(ouvrier, {});
    });

    it.each(['photos', 'documents', 'comments'])('ne lit pas les %s', async (ressource) => {
      const res = await lire(ressource, ouvrier.token);
      expect(res.statusCode).toBe(403);
    });

    it("ne lit pas non plus une ressource precise par son identifiant", async () => {
      // Le contournement classique : la liste est fermee, mais la fiche
      // repondrait quand meme.
      const doc = await app.db('document').where({ chantier_id: chantierId }).first();

      const res = await app.inject({
        method: 'GET',
        url: `/documents/${doc.id}`,
        headers: auth(ouvrier.token),
      });

      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain('Contrat confidentiel');
    });

    it('ne depose rien sans le droit de modifier', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/photos',
        headers: auth(ouvrier.token),
        payload: { chantier_id: chantierId, url: 'http://localhost:3000/files/intrus.jpg' },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('un drapeau ouvre une ressource et une seule', () => {
    it('les photos sans les documents', async () => {
      // Le cas du client : on lui montre l'avancement en images, pas les pieces
      // contractuelles.
      await ajouterMembre(ouvrier, { can_view_photos: true });

      expect((await lire('photos', ouvrier.token)).statusCode).toBe(200);
      expect((await lire('documents', ouvrier.token)).statusCode).toBe(403);
      expect((await lire('comments', ouvrier.token)).statusCode).toBe(403);
    });

    it('les documents sans les discussions', async () => {
      await ajouterMembre(ouvrier, { can_view_documents: true });

      expect((await lire('documents', ouvrier.token)).statusCode).toBe(200);
      expect((await lire('comments', ouvrier.token)).statusCode).toBe(403);
    });

    it('les discussions sans les photos', async () => {
      await ajouterMembre(ouvrier, { can_view_comments: true });

      expect((await lire('comments', ouvrier.token)).statusCode).toBe(200);
      expect((await lire('photos', ouvrier.token)).statusCode).toBe(403);
    });
  });

  describe('droit de modifier', () => {
    it('permet de deposer une photo', async () => {
      await ajouterMembre(ouvrier, { can_view_photos: true, can_edit: true });

      const res = await app.inject({
        method: 'POST',
        url: '/photos',
        headers: auth(ouvrier.token),
        payload: { chantier_id: chantierId, url: 'http://localhost:3000/files/ma-photo.jpg' },
      });

      expect(res.statusCode).toBe(201);
    });

    it("ne suffit pas a lire ce qu'un drapeau de lecture ferme", async () => {
      // Ecrire et lire sont deux droits distincts : un prestataire peut deposer
      // ses pieces sans consulter celles des autres.
      await ajouterMembre(ouvrier, { can_edit: true });

      expect((await lire('documents', ouvrier.token)).statusCode).toBe(403);
    });
  });

  describe('les contournements', () => {
    it("l'administrateur passe outre tous les drapeaux", async () => {
      // Il n'est meme pas membre du chantier.
      expect(await app.db('chantier_member').where({ chantier_id: chantierId, user_id: admin.id }).first()).toBeUndefined();

      expect((await lire('documents', admin.token)).statusCode).toBe(200);
    });

    it('le createur du chantier passe outre ses propres drapeaux', async () => {
      // Il a ete ajoute comme chef de chantier a la creation ; on lui retire
      // tout, il doit continuer de voir le chantier qu'il pilote.
      await app.db('chantier_member').where({ chantier_id: chantierId, user_id: createur.id }).update({
        can_view_documents: false,
        can_view_photos: false,
        can_view_comments: false,
      });
      await app.db('chantier').where({ id: chantierId }).update({ created_by: createur.id });

      expect((await lire('documents', createur.token)).statusCode).toBe(200);
    });

    it("quelqu'un qui n'est pas membre du chantier n'a aucun droit", async () => {
      const etranger = await createUser(app, { organizationId, role: 'employee' });

      expect((await lire('photos', etranger.token)).statusCode).toBe(403);
      expect((await lire('documents', etranger.token)).statusCode).toBe(403);
    });

    it("un membre d'une autre organisation n'a aucun droit", async () => {
      const beta = await createOrgWithAdmin(app, 'Beta Constructions');

      // Meme administrateur de son cote : son statut ne vaut que chez lui.
      const res = await lire('documents', beta.admin.token);

      expect(res.statusCode).not.toBe(200);
      expect(res.body).not.toContain('Contrat confidentiel');
    });
  });

  /**
   * L'URL recue de /upload est deja signee. Stockee telle quelle, son jeton
   * perimait 24 h plus tard et la liste la renvoyait sans la rafraichir :
   * toutes les photos de la veille en 403.
   */
  describe('URLs de fichiers stockees', () => {
    it("stocke l'URL nue et sert un jeton frais", async () => {
      const perime = Buffer.from(JSON.stringify({ f: 'vieille.jpg', e: Date.now() - 1000, s: 'x' })).toString('base64url');
      const res = await app.inject({
        method: 'POST',
        url: '/photos',
        headers: auth(admin.token),
        payload: { chantier_id: chantierId, url: `http://localhost:3000/files/vieille.jpg?t=${perime}` },
      });
      expect(res.statusCode).toBe(201);

      const stockee = await app.db('photo').where({ id: res.json().id }).first();
      expect(stockee.url).toBe('http://localhost:3000/files/vieille.jpg');

      const liste = await app.inject({ method: 'GET', url: `/photos?chantier_id=${chantierId}`, headers: auth(admin.token) });
      const servie = liste.json().data.find((p: { id: string }) => p.id === res.json().id).url as string;
      const jeton = JSON.parse(Buffer.from(new URL(servie).searchParams.get('t')!, 'base64url').toString());
      expect(jeton.e).toBeGreaterThan(Date.now());
    });
  });
});
