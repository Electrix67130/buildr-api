import { Knex } from 'knex';

/**
 * Quand un compte est desactive ou supprime, les contenus qui font l'objet
 * d'un signalement en attente contre lui disparaissent avec lui — et
 * seulement ceux-la. Le reste de ce qu'il a ecrit ou photographie reste :
 * c'est l'historique du chantier, pas le sien.
 *
 * Sans cela, l'administrateur qui coupait le compte depuis un signalement
 * devait encore cliquer « supprimer le contenu », et l'oubliait.
 *
 * Les signalements concernes passent en « traite », avec la mention de ce
 * qui a ete fait. Renvoie le nombre de contenus supprimes.
 */
export async function purgeReportedContent(db: Knex, userId: string, resolvedBy: string | null): Promise<number> {
  const pending = (await db('report')
    .where({ target_user_id: userId, status: 'pending' })
    .whereIn('target_type', ['comment', 'photo'])
    .select('id', 'target_type', 'target_id')) as { id: string; target_type: 'comment' | 'photo'; target_id: string }[];
  if (pending.length === 0) return 0;

  let deleted = 0;
  await db.transaction(async (trx) => {
    for (const type of ['comment', 'photo'] as const) {
      const ids = pending.filter((r) => r.target_type === type).map((r) => r.target_id);
      if (ids.length > 0) deleted += await trx(type).whereIn('id', ids).del();
    }
    await trx('report')
      .whereIn('id', pending.map((r) => r.id))
      .update({
        status: 'resolved',
        resolved_by: resolvedBy,
        resolved_at: trx.fn.now(),
        resolution_note: 'Contenu supprimé avec le compte',
        updated_at: trx.fn.now(),
      });
  });
  return deleted;
}
