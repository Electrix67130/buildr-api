/**
 * Adresses e-mail en minuscules, et unicite insensible a la casse.
 *
 * La contrainte UNIQUE d'origine sur `user.email` distinguait `Arthur@` de
 * `arthur@`. Une meme personne a ainsi obtenu deux comptes, dans deux
 * organisations, selon la majuscule que son telephone avait ajoutee ou non.
 * Les services normalisent desormais toute adresse (voir `src/lib/email.ts`) ;
 * cette migration met l'existant au meme niveau et pose la garantie en base.
 *
 * Stricte, volontairement : s'il reste deux comptes qui ne different que par
 * la casse, on ne peut pas choisir a leur place lequel garder. La migration
 * echoue en les nommant, le deploiement s'arrete avant de remplacer l'API en
 * service (`set -e` dans deploy-api.sh), et on fusionne a la main avant de
 * relancer.
 */

exports.up = async function (knex) {
  const { rows } = await knex.raw(
    `select lower(email) as email, count(*)::int as n, string_agg(email, ', ' order by created_at) as variantes
       from "user" group by lower(email) having count(*) > 1`,
  );
  if (rows.length > 0) {
    const detail = rows.map((r) => `${r.email} (${r.variantes})`).join(' ; ');
    throw new Error(
      `[email] ${rows.length} adresse(s) en doublon a la casse pres, a fusionner avant de migrer : ${detail}`,
    );
  }

  const users = await knex('user').whereRaw('email <> lower(email)').update({ email: knex.raw('lower(email)') });
  const invitations = await knex('invitation')
    .whereRaw('email <> lower(email)')
    .update({ email: knex.raw('lower(email)') });
  console.log(`[email] ${users} compte(s) et ${invitations} invitation(s) passes en minuscules`);

  await knex.raw('create unique index user_email_lower_unique on "user" (lower(email))');
};

exports.down = async function (knex) {
  await knex.raw('drop index if exists user_email_lower_unique');
};
