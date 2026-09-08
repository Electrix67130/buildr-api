import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret, randomToken } from '@/lib/crypto';

/**
 * Chiffrement des secrets stockes en base.
 *
 * Il protege les jetons OAuth des calendriers connectes : un acces en lecture a
 * la base — une sauvegarde egaree, une injection SQL — ne doit pas donner
 * l'agenda professionnel des utilisateurs. AES-256-GCM est authentifie : un
 * chiffre modifie doit etre rejete, pas dechiffre en silence.
 */
describe('Chiffrement des secrets', () => {
  it('rend le texte initial apres un aller-retour', () => {
    const secret = 'ya29.a0AfB_jeton-oauth-google-tres-long';

    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it('supporte l unicode et les chaines vides', () => {
    for (const valeur of ['', 'clé-avec-accents', '日本語', 'a'.repeat(4096)]) {
      expect(decryptSecret(encryptSecret(valeur))).toBe(valeur);
    }
  });

  it('ne produit jamais deux fois le meme chiffre', () => {
    // Un vecteur d'initialisation fixe permettrait de reconnaitre deux comptes
    // qui ont le meme secret.
    const secret = 'meme-secret';
    const chiffres = new Set(Array.from({ length: 20 }, () => encryptSecret(secret)));

    expect(chiffres.size).toBe(20);
  });

  it('ne laisse pas le secret en clair dans le chiffre', () => {
    const chiffre = encryptSecret('mot-de-passe-en-clair');

    expect(chiffre).not.toContain('mot-de-passe');
    expect(Buffer.from(chiffre, 'base64').toString('latin1')).not.toContain('mot-de-passe');
  });

  it('refuse un chiffre modifie', () => {
    // C'est tout l'interet du mode authentifie : sans cela, un octet retourne
    // en base produirait un secret different, accepte sans broncher.
    const chiffre = encryptSecret('jeton-oauth');
    const octets = Buffer.from(chiffre, 'base64');
    octets[octets.length - 1] ^= 0xff;

    expect(() => decryptSecret(octets.toString('base64'))).toThrow();
  });

  it('refuse un chiffre dont le vecteur a ete modifie', () => {
    const chiffre = encryptSecret('jeton-oauth');
    const octets = Buffer.from(chiffre, 'base64');
    octets[0] ^= 0xff;

    expect(() => decryptSecret(octets.toString('base64'))).toThrow();
  });

  it('refuse une entree qui n est pas un chiffre', () => {
    for (const entree of ['', 'pas-du-base64!!', Buffer.from('trop court').toString('base64')]) {
      expect(() => decryptSecret(entree), entree).toThrow();
    }
  });
});

describe('Jetons aleatoires', () => {
  it('sont utilisables tels quels dans une URL', () => {
    // Ils servent de jetons d'invitation et de partage : un caractere a
    // echapper casserait le lien.
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('ne se repetent pas', () => {
    const jetons = new Set(Array.from({ length: 500 }, () => randomToken()));

    expect(jetons.size).toBe(500);
  });

  it('respectent la longueur demandee', () => {
    // 48 octets par defaut, encodes en base64url.
    expect(Buffer.from(randomToken(), 'base64url')).toHaveLength(48);
    expect(Buffer.from(randomToken(16), 'base64url')).toHaveLength(16);
  });
});
