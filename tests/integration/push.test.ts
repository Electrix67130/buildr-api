import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, auth } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import { createOrgWithAdmin, createUser, type TestUser } from '../helpers/factories';

/**
 * Envoi des notifications push.
 *
 * Une notification de chantier part a plusieurs personnes a la fois. Elles ne
 * parlent pas forcement la meme langue — un chantier peut employer un chef
 * francophone et des ouvriers qui ne le sont pas. Ce qui est verifie ici, c'est
 * que chacun la recoit dans la sienne, en un seul appel a Expo.
 */
interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: { type?: string };
}

describe('Notifications push', () => {
  let app: FastifyInstance;
  let organizationId: string;
  let admin: TestUser;
  let ouvrierAllemand: TestUser;
  let ouvrierTurc: TestUser;
  let chantierId: string;
  let envois: { url: string; messages: PushMessage[] }[];

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
    ouvrierAllemand = await createUser(app, { organizationId, role: 'employee', locale: 'de' });
    ouvrierTurc = await createUser(app, { organizationId, role: 'employee', locale: 'tr' });

    const chantier = await app.inject({
      method: 'POST',
      url: '/chantiers',
      headers: auth(admin.token),
      payload: { name: 'Pont de la Loire' },
    });
    chantierId = chantier.json().id;

    // Les membres d'abord, les jetons ensuite. Ajouter quelqu'un a un chantier
    // envoie une notification : sans jeton a ce moment-la, l'envoi s'arrete
    // avant l'appel reseau et ne vient pas polluer ce que le test observe.
    for (const membre of [ouvrierAllemand, ouvrierTurc]) {
      await app.inject({
        method: 'POST',
        url: '/chantier-members',
        headers: auth(admin.token),
        payload: { chantier_id: chantierId, user_id: membre.id, role: 'ouvrier' },
      });
    }
    for (const compte of [admin, ouvrierAllemand, ouvrierTurc]) {
      await app.db('push_token').insert({
        user_id: compte.id,
        token: `ExponentPushToken[${compte.id}]`,
        platform: 'ios',
      });
    }

    // On intercepte l'appel a Expo : aucun test ne doit sortir sur le reseau.
    envois = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      envois.push({ url: String(url), messages: JSON.parse(String(init?.body ?? '[]')) });
      return { ok: true, json: async () => ({ data: [{ status: 'ok' }] }) } as unknown as Response;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Les envois d'un type donne.
   *
   * Filtrer par type n'est pas une precaution de style : les notifications
   * d'ajout au chantier declenchees par la preparation partent en arriere-plan
   * et peuvent atterrir pendant le test. Aucun ordre d'instructions ne les
   * rattrape — seul le contenu permet de les distinguer.
   */
  const envoisDeType = (type: string) =>
    envois.filter((e) => e.messages.some((m) => m.data?.type === type));

  const messagePour = (membre: TestUser, type: string) =>
    envois
      .flatMap((e) => e.messages)
      .find((m) => m.to === `ExponentPushToken[${membre.id}]` && m.data?.type === type);

  /** L'envoi est detache de la reponse HTTP : il faut lui laisser le temps. */
  const attendreMessagePour = (membre: TestUser, type: string) =>
    vi.waitFor(() => expect(messagePour(membre, type)).toBeDefined(), { timeout: 3000 });

  const commenter = () =>
    app.inject({
      method: 'POST',
      url: '/comments',
      headers: auth(admin.token),
      payload: { chantier_id: chantierId, content: 'Le beton est coule ce matin' },
    });

  it('ecrit a chacun dans la langue de son compte', async () => {
    // Une photo : le corps du message est entierement traduit, contrairement a
    // un commentaire qui n'est que le texte de son auteur.
    await app.inject({
      method: 'POST',
      url: '/photos',
      headers: auth(admin.token),
      payload: { chantier_id: chantierId, url: 'http://localhost:3000/files/photo-1.jpg' },
    });
    await attendreMessagePour(ouvrierAllemand, 'photo');
    await attendreMessagePour(ouvrierTurc, 'photo');

    expect(messagePour(ouvrierAllemand, 'photo')?.body).toContain('hat ein Foto hinzugefügt');
    expect(messagePour(ouvrierTurc, 'photo')?.body).toContain('bir fotoğraf ekledi');
  });

  it("n'a besoin que d'un seul appel a Expo pour toutes les langues", async () => {
    // L'API d'Expo accepte des messages differents dans un meme lot : traduire
    // ne doit couter aucun appel reseau supplementaire.
    await app.inject({
      method: 'POST',
      url: '/photos',
      headers: auth(admin.token),
      payload: { chantier_id: chantierId, url: 'http://localhost:3000/files/photo-1.jpg' },
    });
    await attendreMessagePour(ouvrierAllemand, 'photo');
    await attendreMessagePour(ouvrierTurc, 'photo');

    expect(envoisDeType('photo')).toHaveLength(1);
    expect(envoisDeType('photo')[0].messages).toHaveLength(2);
  });

  it("ne previent pas celui qui vient d'agir", async () => {
    await commenter();
    await attendreMessagePour(ouvrierAllemand, 'comment');

    expect(messagePour(admin, 'comment')).toBeUndefined();
    expect(messagePour(ouvrierAllemand, 'comment')).toBeDefined();
  });

  it('nomme le chantier dans le titre, quelle que soit la langue', async () => {
    await commenter();
    await attendreMessagePour(ouvrierTurc, 'comment');

    expect(messagePour(ouvrierAllemand, 'comment')?.title).toContain('Pont de la Loire');
    expect(messagePour(ouvrierTurc, 'comment')?.title).toContain('Pont de la Loire');
  });

  it("laisse un message de discussion tel que son auteur l'a ecrit", async () => {
    // Rien a traduire ici : traduire le message de quelqu'un serait le trahir.
    await commenter();
    await attendreMessagePour(ouvrierTurc, 'comment');

    expect(messagePour(ouvrierTurc, 'comment')?.body).toContain('Le beton est coule ce matin');
  });

  it('respecte le refus des notifications, compte par compte', async () => {
    await app.db('user').where({ id: ouvrierAllemand.id }).update({ push_enabled: false });

    await commenter();
    await attendreMessagePour(ouvrierTurc, 'comment');

    expect(messagePour(ouvrierAllemand, 'comment')).toBeUndefined();
    expect(messagePour(ouvrierTurc, 'comment')).toBeDefined();
  });

  it("retombe sur le francais pour une langue inconnue", async () => {
    // Une valeur inattendue en base ne doit pas produire une notification vide.
    await app.db('user').where({ id: ouvrierTurc.id }).update({ locale: 'zz' });

    await app.inject({
      method: 'POST',
      url: '/photos',
      headers: auth(admin.token),
      payload: { chantier_id: chantierId, url: 'http://localhost:3000/files/photo-1.jpg' },
    });
    await attendreMessagePour(ouvrierTurc, 'photo');

    expect(messagePour(ouvrierTurc, 'photo')?.body).toContain('a ajouté une photo');
  });

  it('suit le changement de langue fait par le destinataire', async () => {
    // La chaine complete : quelqu'un change la langue de l'application, son
    // compte est mis a jour, et les notifications suivantes arrivent dans cette
    // langue. Sans le dernier maillon, traduire les notifications ne servait a
    // rien.
    const res = await app.inject({
      method: 'PATCH',
      url: `/users/${ouvrierTurc.id}`,
      headers: auth(ouvrierTurc.token),
      payload: { locale: 'es' },
    });
    expect(res.statusCode).toBe(200);

    await app.inject({
      method: 'POST',
      url: '/photos',
      headers: auth(admin.token),
      payload: { chantier_id: chantierId, url: 'http://localhost:3000/files/photo-1.jpg' },
    });
    await attendreMessagePour(ouvrierTurc, 'photo');

    expect(messagePour(ouvrierTurc, 'photo')?.body).toContain('ha añadido una foto');
  });

  it("previent le nouveau membre dans sa langue quand on l'ajoute a un chantier", async () => {
    const nouveau = await createUser(app, { organizationId, role: 'employee', locale: 'pl' });
    await app.db('push_token').insert({
      user_id: nouveau.id,
      token: `ExponentPushToken[${nouveau.id}]`,
      platform: 'ios',
    });

    await app.inject({
      method: 'POST',
      url: '/chantier-members',
      headers: auth(admin.token),
      payload: { chantier_id: chantierId, user_id: nouveau.id, role: 'ouvrier' },
    });
    await attendreMessagePour(nouveau, 'chantier-member');

    expect(messagePour(nouveau, 'chantier-member')?.body).toContain('dodano Cię do tej budowy');
  });
});
