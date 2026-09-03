/**
 * Langue de l'utilisateur, pour les e-mails qu'on lui envoie.
 *
 * Le mail de reinitialisation de mot de passe partait en francais pour tout le
 * monde. Contrairement a l'invitation, personne ne peut choisir la langue au
 * moment de l'envoi : c'est l'utilisateur lui-meme qui declenche la demande, et
 * il n'est pas connecte. Il faut donc la connaitre a l'avance.
 *
 * Elle est renseignee a l'inscription : depuis l'invitation quand il y en a une
 * — l'employeur avait deja choisi la langue de son collaborateur — sinon depuis
 * la langue de l'interface au moment de la creation du compte.
 */
exports.up = function (knex) {
  return knex.schema.alterTable('user', (table) => {
    table.string('locale', 5).notNullable().defaultTo('fr');
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('user', (table) => {
    table.dropColumn('locale');
  });
};
