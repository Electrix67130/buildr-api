/**
 * Suppression de compte auto-service (exigence Apple App Store, guideline 5.1.1(v)).
 *
 * Plusieurs FK vers `user` sont en RESTRICT (chantier.created_by, invitation.invited_by,
 * organization.created_by) : un DELETE physique echoue des que l'utilisateur a cree un
 * chantier. On anonymise donc la ligne au lieu de la supprimer — les donnees personnelles
 * sont effacees (RGPD) et les enregistrements metier de l'organisation sont preserves.
 *
 * `deleted_at` marque le compte comme supprime et sert de garde-fou aux requetes.
 */
exports.up = function (knex) {
  return knex.schema.alterTable('user', (table) => {
    table.timestamp('deleted_at').index();
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('user', (table) => {
    table.dropColumn('deleted_at');
  });
};
