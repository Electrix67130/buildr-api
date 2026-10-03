import { describe, it, expect } from 'vitest';
import { normalizeEmail, emailSchema } from '@/lib/email';

/**
 * Normalisation des adresses e-mail.
 *
 * Deux ecritures d'une meme adresse doivent designer le meme compte : c'est
 * ce qui a manque quand un salarie s'est retrouve avec deux comptes, l'un en
 * minuscules, l'autre avec la majuscule ajoutee par son telephone.
 */
describe('normalizeEmail', () => {
  it('passe en minuscules', () => {
    expect(normalizeEmail('Arthur.Andre@Gmail.com')).toBe('arthur.andre@gmail.com');
  });

  it('retire les espaces autour', () => {
    expect(normalizeEmail('  arthur@gmail.com ')).toBe('arthur@gmail.com');
  });
});

describe('emailSchema', () => {
  it('valide puis normalise', () => {
    expect(emailSchema.parse(' Arthur@Gmail.com ')).toBe('arthur@gmail.com');
  });

  it("refuse ce qui n'est pas une adresse", () => {
    expect(() => emailSchema.parse('arthur')).toThrow();
  });

  it('refuse une adresse trop longue', () => {
    expect(() => emailSchema.parse(`${'a'.repeat(250)}@gmail.com`)).toThrow();
  });
});
