import { describe, it, expect } from 'vitest';
import { toE164, normalizePhone, PHONE_INPUT_PATTERN } from '@/lib/phone';

/**
 * Normalisation des telephones.
 *
 * Un seul format en base, E.164 : ce que verifient ces tests, c'est que les
 * saisies courantes y aboutissent toutes, et que ce qui n'est pas un numero
 * n'y aboutit jamais.
 */

describe('toE164', () => {
  it('ramene les ecritures francaises usuelles au meme numero', () => {
    for (const saisie of ['0612345678', '06 12 34 56 78', '06.12.34.56.78', '06-12-34-56-78', '+33 6 12 34 56 78', '+33612345678', '0033612345678']) {
      expect(toE164(saisie, 'FR'), saisie).toBe('+33612345678');
    }
  });

  it("suppose la France quand le pays n'est pas connu", () => {
    expect(toE164('0612345678')).toBe('+33612345678');
    expect(toE164('0612345678', null)).toBe('+33612345678');
    expect(toE164('0612345678', 'XX')).toBe('+33612345678');
  });

  it("interprete un numero sans indicatif avec le pays de l'organisation", () => {
    expect(toE164('0151 23456789', 'DE')).toBe('+4915123456789');
    expect(toE164('0151 23456789', 'de')).toBe('+4915123456789');
    expect(toE164('612 345 678', 'ES')).toBe('+34612345678');
  });

  it("garde l'indicatif saisi, quel que soit le pays de reference", () => {
    expect(toE164('+49 151 23456789', 'FR')).toBe('+4915123456789');
    expect(toE164('+33 6 12 34 56 78', 'DE')).toBe('+33612345678');
  });

  it("rend null pour ce qui n'est pas un numero", () => {
    for (const saisie of ['bonjour', '123', '06 12', '+33 1', '']) {
      expect(toE164(saisie, 'FR'), saisie).toBeNull();
    }
    expect(toE164(null)).toBeNull();
    expect(toE164(undefined)).toBeNull();
  });
});

describe('normalizePhone', () => {
  it('efface plutot que de refuser un champ vide', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('   ')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });

  it('refuse en 400 un numero invalide', () => {
    expect(() => normalizePhone('bonjour', 'FR')).toThrow(expect.objectContaining({ statusCode: 400 }));
  });
});

describe('PHONE_INPUT_PATTERN', () => {
  // Filtre grossier au niveau Zod, avant de connaitre le pays : il ecarte le
  // hors-sujet evident, pas les numeros faux.
  it('laisse passer les ponctuations de saisie courantes', () => {
    for (const saisie of ['0612345678', '06 12 34 56 78', '06.12.34.56.78', '+33 (0)6 12 34 56 78', '+49-151-23456789']) {
      expect(PHONE_INPUT_PATTERN.test(saisie), saisie).toBe(true);
    }
  });

  it('ecarte le texte et les saisies trop courtes', () => {
    for (const saisie of ['bonjour', '06 12 34 56 78 poste 4', '', '12345']) {
      expect(PHONE_INPUT_PATTERN.test(saisie), saisie).toBe(false);
    }
  });
});
