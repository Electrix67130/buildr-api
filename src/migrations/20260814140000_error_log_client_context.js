/**
 * Contexte client dans error_log.
 *
 * La table ne recevait que les 500 de l'API : ses colonnes decrivent une requete
 * HTTP (route, method, status_code). Pour y accueillir les plantages de l'app
 * mobile et du dashboard, il faut savoir d'ou vient l'erreur et sur quelle
 * version — sans quoi on ne distingue pas un crash iOS d'une erreur serveur.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('error_log', (table) => {
    // 'api' | 'mobile' | 'dashboard'
    table.string('source', 20).notNullable().defaultTo('api');
    // 'ios' | 'android' | 'web' — nul pour les erreurs serveur.
    table.string('platform', 20);
    // Version de l'app ou du build, pour savoir si une correction a bien pris.
    table.string('app_version', 40);
    // Ecran ou composant concerne, cote client (la colonne `route` reste
    // reservee a l'URL HTTP des erreurs serveur).
    table.string('screen', 200);
    table.index(['source', 'created_at'], 'idx_error_log_source_created');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('error_log', (table) => {
    table.dropIndex(['source', 'created_at'], 'idx_error_log_source_created');
    table.dropColumn('source');
    table.dropColumn('platform');
    table.dropColumn('app_version');
    table.dropColumn('screen');
  });
};
