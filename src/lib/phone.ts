import { Knex } from 'knex';
import { parsePhoneNumberFromString, isSupportedCountry, type CountryCode } from 'libphonenumber-js';

/**
 * Un seul format de telephone en base : E.164 (`+33612345678`).
 *
 * Avant ce module, `phone` etait un `z.string().max(20)` sans le moindre
 * controle : la meme personne pouvait etre enregistree `06 12 34 56 78`,
 * `0612345678` ou `06.12.34.56.78` selon l'ecran de saisie, et rien
 * n'empechait d'y mettre du texte. Les fiches collaborateur ouvrent un lien
 * `tel:` avec la valeur telle quelle — un numero mal saisi ne passait
 * simplement pas l'appel.
 *
 * E.164 plutot que le format national : Buildr est traduit en huit langues et
 * un chantier peut employer des ouvriers etrangers. Sans indicatif, un
 * `0151...` allemand et un numero francais sont indistinguables.
 */

/** Pays de repli quand l'organisation n'a pas renseigne le sien. */
export const DEFAULT_PHONE_COUNTRY: CountryCode = 'FR';

/**
 * Forme acceptee en entree : chiffres et ponctuation de saisie courante.
 *
 * Volontairement large — c'est `toE164()` qui tranche la validite reelle. Ce
 * motif ne sert qu'a ecarter le hors-sujet evident au niveau Zod, avant meme
 * de connaitre le pays de reference.
 */
export const PHONE_INPUT_PATTERN = /^[+()\d\s.\-/]{6,30}$/;

/** Longueur maximale acceptee a la saisie, separateurs compris. */
export const PHONE_INPUT_MAX = 30;

/**
 * Convertit une saisie en E.164, ou `null` si le numero n'est pas valide.
 *
 * Ne leve jamais : les appelants qui doivent refuser une saisie utilisent
 * `normalizePhone()`, la migration se sert de celle-ci pour trier.
 */
export function toE164(value: string | null | undefined, country?: string | null): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;

  const reference = country?.toUpperCase();
  const defaultCountry =
    reference && isSupportedCountry(reference) ? (reference as CountryCode) : DEFAULT_PHONE_COUNTRY;

  const parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

/**
 * Normalise une saisie destinee a la base, ou rejette en 400.
 *
 * `null` et `''` sont rendus comme `null` : un telephone facultatif qu'on
 * efface doit pouvoir l'etre. Les routes qui l'exigent le declarent dans leur
 * schema Zod.
 */
export function normalizePhone(value: string | null | undefined, country?: string | null): string | null {
  if (value === null || value === undefined || value.trim() === '') return null;

  const normalized = toE164(value, country);
  if (!normalized) {
    throw Object.assign(new Error('Numéro de téléphone invalide'), { statusCode: 400 });
  }
  return normalized;
}

/**
 * Pays de reference d'une organisation, pour interpreter un numero sans indicatif.
 *
 * `organization.country` est renseigne par le formulaire d'informations
 * legales ; tant qu'il est vide on suppose la France, qui reste le marche de
 * tous les comptes actuels.
 */
export async function resolveOrganizationCountry(
  db: Knex,
  organizationId: string | null | undefined,
): Promise<CountryCode> {
  if (!organizationId) return DEFAULT_PHONE_COUNTRY;
  const org = (await db('organization').where({ id: organizationId }).select('country').first()) as
    | { country?: string | null }
    | undefined;
  const country = org?.country?.toUpperCase();
  return country && isSupportedCountry(country) ? (country as CountryCode) : DEFAULT_PHONE_COUNTRY;
}
