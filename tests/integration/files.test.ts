import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createTestApp, auth } from '../helpers/app';
import { truncateAll } from '../helpers/db';
import { createOrgWithAdmin, type TestUser } from '../helpers/factories';
import { signFileUrl } from '@/lib/sign-url';
import { UPLOAD_DIR } from '@/lib/storage';
import fs from 'fs';
import path from 'path';

/**
 * Acces aux fichiers servis par /files/.
 *
 * Cette route est la seule de l'API a ne pas exiger de cle d'API : les images
 * doivent pouvoir etre affichees directement par un navigateur ou l'app. Le
 * jeton signe est donc son unique protection. Photos de chantier, documents
 * contractuels et avatars en dependent.
 */
describe('Acces aux fichiers', () => {
  let app: FastifyInstance;
  let admin: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(app.db);
    admin = (await createOrgWithAdmin(app, 'Alpha TP')).admin;
  });

  /** Chemin signe, pret a etre demande. */
  const cheminSigne = (nom: string) => {
    const url = new URL(signFileUrl(`http://localhost:3000/files/${nom}`));
    return url.pathname + url.search;
  };

  it('refuse une demande sans jeton', async () => {
    const res = await app.inject({ method: 'GET', url: '/files/photo-123.jpg' });
    expect(res.statusCode).not.toBe(200);
    expect([400, 403]).toContain(res.statusCode);
  });

  it('refuse un jeton illisible', async () => {
    const res = await app.inject({ method: 'GET', url: '/files/photo-123.jpg?t=nimporte-quoi' });
    expect(res.statusCode).toBe(403);
  });

  it("refuse le jeton d'un autre fichier", async () => {
    // Le jeton doit valoir pour UN fichier, pas pour le repertoire.
    const jeton = new URL(signFileUrl('http://localhost:3000/files/ma-photo.jpg')).searchParams.get('t');

    const res = await app.inject({ method: 'GET', url: `/files/contrat-confidentiel.pdf?t=${jeton}` });
    expect(res.statusCode).toBe(403);
  });

  it('accepte un jeton valide et cherche alors le fichier', async () => {
    // 404 et non 403 : la signature a ete acceptee, c'est le fichier qui manque.
    const res = await app.inject({ method: 'GET', url: cheminSigne('fichier-absent.jpg') });
    expect(res.statusCode).toBe(404);
  });

  it("ne remonte pas l'arborescence", async () => {
    const res = await app.inject({ method: 'GET', url: '/files/..%2F..%2F.env?t=nimporte-quoi' });
    expect(res.statusCode).not.toBe(200);
    expect(res.body).not.toContain('DB_PASSWORD');
  });

  it("autorise le cache prive du fichier, et jamais celui d'un fichier absent", async () => {
    // L'URL est stable six heures : le telephone et le navigateur peuvent
    // garder l'image au lieu de la retelecharger a chaque rafraichissement.
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const nom = 'cache-test.jpg';
    fs.writeFileSync(path.join(UPLOAD_DIR, nom), Buffer.from('fake'));
    try {
      const present = await app.inject({ method: 'GET', url: cheminSigne(nom) });
      expect(present.statusCode).toBe(200);
      expect(present.headers['cache-control']).toBe('private, max-age=43200');

      const absent = await app.inject({ method: 'GET', url: cheminSigne('fichier-absent.jpg') });
      expect(absent.statusCode).toBe(404);
      expect(absent.headers['cache-control'] ?? '').not.toContain('max-age=43200');
    } finally {
      fs.rmSync(path.join(UPLOAD_DIR, nom), { force: true });
    }
  });

  it('autorise le navigateur a afficher le fichier depuis une autre origine', async () => {
    // Sans cet en-tete, helmet fait bloquer les images de l'API par le
    // dashboard, qui vit sur un autre domaine.
    const res = await app.inject({ method: 'GET', url: cheminSigne('fichier-absent.jpg') });
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('signe les URLs de fichiers presentes dans les reponses', async () => {
    await app.db('user').where({ id: admin.id }).update({
      avatar_url: 'http://localhost:3000/files/avatar-42.jpg',
    });

    const res = await app.inject({ method: 'GET', url: '/auth/me', headers: auth(admin.token) });

    expect(res.statusCode).toBe(200);
    expect(res.json().avatar_url).toContain('?t=');
  });

  it("n'exige pas de cle d'API, contrairement au reste de l'API", async () => {
    // C'est voulu : une balise <img> ne peut pas porter d'en-tete.
    const res = await app.inject({
      method: 'GET',
      url: cheminSigne('fichier-absent.jpg'),
      headers: { 'x-api-key': 'cle-invalide' },
    });

    expect(res.statusCode).toBe(404);
  });
});
