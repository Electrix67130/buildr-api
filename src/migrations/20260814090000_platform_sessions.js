/**
 * Sessions separees par plateforme.
 *
 * Jusqu'ici un seul `current_session_id` par utilisateur : se connecter sur le
 * mobile invalidait la session du dashboard, et inversement. Or un chef de
 * chantier utilise les deux en meme temps — l'app sur le terrain, le dashboard
 * au bureau.
 *
 * On garde une session active par plateforme. Une nouvelle connexion mobile ne
 * chasse que la precedente session mobile.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('user', (table) => {
    // Meme type que l'ancienne colonne current_session_id (varchar 64), pour
    // que la reprise des sessions en cours ne demande aucun cast.
    table.string('current_mobile_session_id', 64);
    table.string('current_web_session_id', 64);
  });

  // La session en cours est reconduite sur les deux plateformes : personne
  // n'est deconnecte par la migration.
  await knex('user')
    .whereNotNull('current_session_id')
    .update({
      current_mobile_session_id: knex.ref('current_session_id'),
      current_web_session_id: knex.ref('current_session_id'),
    });

  await knex.schema.alterTable('user', (table) => {
    table.dropColumn('current_session_id');
  });

  // Le refresh token porte sa plateforme : c'est elle qui determine quelle
  // session renouveler. Nullable pour les jetons emis avant cette migration.
  await knex.schema.alterTable('refresh_token', (table) => {
    table.enu('platform', ['mobile', 'web'], {
      useNative: true,
      enumName: 'session_platform',
    });
    table.index(['user_id', 'platform'], 'idx_refresh_token_user_platform');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('refresh_token', (table) => {
    table.dropIndex(['user_id', 'platform'], 'idx_refresh_token_user_platform');
    table.dropColumn('platform');
  });
  await knex.raw('DROP TYPE IF EXISTS session_platform');

  await knex.schema.alterTable('user', (table) => {
    table.string('current_session_id', 64);
  });
  await knex('user')
    .whereNotNull('current_web_session_id')
    .update({ current_session_id: knex.ref('current_web_session_id') });

  await knex.schema.alterTable('user', (table) => {
    table.dropColumn('current_mobile_session_id');
    table.dropColumn('current_web_session_id');
  });
};
