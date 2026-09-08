import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { signFileUrl, signUrlsDeep, signUrlsIn, signUrlsInList, FILE_URL_TTL_MS } from '@/lib/sign-url';

/**
 * Signature des URLs de fichiers.
 *
 * C'est le seul rempart devant les photos et documents de chantier : le
 * endpoint /files/ n'exige pas de cle d'API, il ne verifie que ce jeton. Une
 * erreur ici rend soit les images invisibles, soit les fichiers publics.
 */

/** Rejoue la verification faite par le serveur au moment de servir le fichier. */
function decoder(url: string): { f: string; e: number; s: string } {
  const jeton = new URL(url).searchParams.get('t');
  expect(jeton).toBeTruthy();
  return JSON.parse(Buffer.from(jeton!, 'base64url').toString());
}

function signatureValide(charge: { f: string; e: number; s: string }): boolean {
  const attendue = createHmac('sha256', process.env.JWT_SECRET!).update(`${charge.f}:${charge.e}`).digest('hex');
  return charge.s === attendue;
}

describe('Signature des URLs de fichiers', () => {
  it('ajoute un jeton verifiable a une URL de fichier', () => {
    const url = signFileUrl('http://localhost:3000/files/photo-123.jpg');

    const charge = decoder(url);
    expect(charge.f).toBe('photo-123.jpg');
    expect(signatureValide(charge)).toBe(true);
  });

  it('fait porter la signature sur le nom du fichier', () => {
    // Sans cela, le jeton d'une image servirait a en telecharger une autre.
    const charge = decoder(signFileUrl('http://localhost:3000/files/photo-123.jpg'));
    const detourne = { ...charge, f: 'contrat-confidentiel.pdf' };

    expect(signatureValide(detourne)).toBe(false);
  });

  it('fait porter la signature sur la date de peremption', () => {
    // Sans cela, il suffirait de reculer la date pour obtenir un jeton eternel.
    const charge = decoder(signFileUrl('http://localhost:3000/files/photo-123.jpg'));
    const prolonge = { ...charge, e: charge.e + 10 * 365 * 24 * 3600 * 1000 };

    expect(signatureValide(prolonge)).toBe(false);
  });

  it('accorde la duree de validite annoncee', () => {
    const avant = Date.now();
    const charge = decoder(signFileUrl('http://localhost:3000/files/photo-123.jpg'));

    expect(charge.e).toBeGreaterThanOrEqual(avant + FILE_URL_TTL_MS);
    expect(charge.e).toBeLessThanOrEqual(Date.now() + FILE_URL_TTL_MS);
  });

  it("laisse intactes les adresses externes", () => {
    const externe = 'https://lh3.googleusercontent.com/avatar.png';

    expect(signUrlsIn({ avatar_url: externe }).avatar_url).toBe(externe);

    // A noter : le tri se fait chez l'appelant, pas dans signFileUrl(). Appelee
    // directement sur une adresse externe, elle la reecrirait en URL /files/ de
    // l'API — elle ne garde que le dernier segment du chemin. Aucun appelant ne
    // le fait aujourd'hui ; ce test est la pour qu'on s'en souvienne si l'un
    // d'eux venait a le faire.
    expect(signFileUrl(externe)).toContain('/files/avatar.png');
  });

  it("ne resigne pas une URL qui porte deja un jeton", () => {
    // Comportement voulu — resigner produirait un nom de fichier contenant la
    // query string, donc un 404.
    //
    // Mais c'est aussi ce qui rend definitive la peremption d'une URL signee
    // ENREGISTREE EN BASE : elle ne sera jamais rafraichie. Les clients stockent
    // la reponse de /upload, deja signee. Tant que ce sera le cas, allonger la
    // duree de validite ne fera que retarder la panne.
    const signee = signFileUrl('http://localhost:3000/files/photo-123.jpg');

    expect(signFileUrl(signee)).toBe(signee);
  });

  it('signe toutes les URLs de fichiers, quel que soit le nom du champ', () => {
    // Regression : seuls `url` et `thumbnail_url` etaient traites. `photo_url`,
    // `avatar_url` et `logo_url` partaient sans jeton — vignettes noires, sans
    // message d'erreur.
    const signe = signUrlsIn({
      url: 'http://localhost:3000/files/a.jpg',
      photo_url: 'http://localhost:3000/files/b.jpg',
      avatar_url: 'http://localhost:3000/files/c.jpg',
      logo_url: 'http://localhost:3000/files/d.jpg',
      nom: 'Chantier',
    });

    for (const champ of ['url', 'photo_url', 'avatar_url', 'logo_url'] as const) {
      expect(signe[champ]).toContain('?t=');
    }
    expect(signe.nom).toBe('Chantier');
  });

  it('signe les URLs imbriquees dans une reponse complete', () => {
    const signe = signUrlsDeep({
      data: [
        { id: '1', photos: [{ url: 'http://localhost:3000/files/a.jpg' }] },
        { id: '2', auteur: { avatar_url: 'http://localhost:3000/files/b.jpg' } },
      ],
      meta: { total: 2 },
    }) as { data: [{ photos: [{ url: string }] }, { auteur: { avatar_url: string } }]; meta: { total: number } };

    expect(signe.data[0].photos[0].url).toContain('?t=');
    expect(signe.data[1].auteur.avatar_url).toContain('?t=');
    expect(signe.meta.total).toBe(2);
  });

  it('ne denature pas les valeurs qui ne sont pas de simples donnees', () => {
    // Serialiser une Date autrement casserait la reponse.
    const date = new Date('2026-01-01T00:00:00Z');
    const signe = signUrlsDeep({ created_at: date, rien: null, nombre: 3 }) as Record<string, unknown>;

    expect(signe.created_at).toBe(date);
    expect(signe.rien).toBeNull();
    expect(signe.nombre).toBe(3);
  });

  it('traite une liste sans la reordonner ni la muter', () => {
    const source = [{ url: 'http://localhost:3000/files/a.jpg' }, { url: 'https://exemple.fr/b.jpg' }];
    const signe = signUrlsInList(source);

    expect(signe).toHaveLength(2);
    expect(signe[0].url).toContain('?t=');
    expect(signe[1].url).toBe('https://exemple.fr/b.jpg');
    expect(source[0].url).toBe('http://localhost:3000/files/a.jpg');
  });
});
