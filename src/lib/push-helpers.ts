import { Knex } from 'knex';

/** Fetch le prenom + nom + le nom du chantier en une requete chacune. Helper pour push. */
export async function getActorAndChantierNames(
  db: Knex,
  userId: string,
  chantierId: string,
): Promise<{ actorName: string; chantierName: string }> {
  const [user, chantier] = await Promise.all([
    db('user').where({ id: userId }).select('first_name', 'last_name').first(),
    db('chantier').where({ id: chantierId }).select('name').first(),
  ]);
  return {
    actorName: user ? `${user.first_name} ${user.last_name}` : 'Quelqu\'un',
    chantierName: chantier?.name ?? 'un chantier',
  };
}

/** Tronque un texte a `n` caracteres avec une ellipse. */
export function truncate(text: string, n = 80): string {
  if (text.length <= n) return text;
  return text.slice(0, n - 1).trimEnd() + '…';
}
