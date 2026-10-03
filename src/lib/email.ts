import { z } from 'zod';

/**
 * Normalisation des adresses e-mail.
 *
 * Une adresse n'a pas de casse pour celui qui la recoit : Gmail livre
 * `Arthur@gmail.com` et `arthur@gmail.com` dans la meme boite. L'API, elle,
 * les tenait pour deux adresses distinctes — recherche, unicite en base et
 * correspondance avec l'invitation comprises. Un salarie inscrit seul en
 * minuscules, puis invite avec une majuscule que son telephone avait ajoutee,
 * se retrouvait avec deux comptes, chacun dans une organisation differente.
 *
 * Tout e-mail qui entre dans l'API passe par ici, et la base porte un index
 * unique sur `lower(email)` : les deux ecritures designent le meme compte.
 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Champ e-mail des schemas Zod : valide, puis normalise. */
export const emailSchema = z.string().trim().email().max(255).transform(normalizeEmail);
