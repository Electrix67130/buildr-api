/**
 * Tolerance de reutilisation des jetons de rafraichissement.
 *
 * La rotation supprimait l'ancien jeton avant meme que la reponse ne parte.
 * Reponse perdue — reseau coupe, app tuee — et l'appareil gardait un jeton
 * mort : deconnecte au renouvellement suivant, sans avoir rien fait de mal.
 *
 * Le jeton remplace reste en base le temps d'une tolerance, avec la date de
 * son remplacement et le jeton qui lui a succede. Rejoue dans ce delai, il
 * redonne la session en cours au lieu d'etre refuse. Voir AuthService.
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('refresh_token', (table) => {
    table.timestamp('replaced_at').nullable();
    table.text('replaced_by').nullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('refresh_token', (table) => {
    table.dropColumn('replaced_at');
    table.dropColumn('replaced_by');
  });
};
