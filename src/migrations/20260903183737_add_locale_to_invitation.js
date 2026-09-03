/**
 * Langue du mail d'invitation.
 *
 * Le mail etait redige en francais en dur, alors que l'app est traduite en huit
 * langues : on invitait un ouvrier polonais dans une langue qu'il ne lit pas.
 * La langue est choisie par celui qui invite, au moment ou il invite — lui seul
 * sait dans quelle langue son collaborateur travaille.
 *
 * Stockee sur l'invitation plutot que passee en volee : un renvoi doit repartir
 * dans la meme langue, sans que l'expediteur ait a s'en souvenir.
 */
exports.up = function (knex) {
  return knex.schema.alterTable('invitation', (table) => {
    table.string('locale', 5).notNullable().defaultTo('fr');
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('invitation', (table) => {
    table.dropColumn('locale');
  });
};
