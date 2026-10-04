/**
 * Retire les jetons de signature des URLs de fichiers stockees.
 *
 * Le hook global signe toutes les reponses, celle de /upload comprise : les
 * clients renvoyaient a la creation l'URL deja signee, et la base gardait un
 * jeton perime 24 h plus tard. La signature des listes laissait passer une URL
 * deja signee, donc perimee : toutes les photos de la veille en 403.
 *
 * Reprise de donnees pure : la partie avant le `?` est l'URL nue attendue.
 */

const TARGETS = [
  ['photo', 'url'],
  ['photo', 'thumbnail_url'],
  ['chantier_emergency', 'photo_url'],
  ['chantier_emergency', 'thumbnail_url'],
  ['document', 'url'],
  ['user', 'avatar_url'],
  ['organization', 'logo_url'],
];

exports.up = async function (knex) {
  for (const [table, column] of TARGETS) {
    const has = await knex.schema.hasColumn(table, column);
    if (!has) continue;
    const res = await knex.raw(
      `update "${table}" set "${column}" = split_part("${column}", '?', 1)
        where "${column}" like '%/files/%?%'`,
    );
    console.log(`[files] ${table}.${column} : ${res.rowCount} URL(s) nettoyee(s)`);
  }
};

exports.down = async function () {
  // Rien a defaire : un jeton perime n'a aucune valeur.
};
