/**
 * Signalements des utilisateurs : bugs rencontres et suggestions de
 * fonctionnalites.
 *
 * Distinct de `error_log`, qui collecte les plantages automatiquement : ici
 * c'est un humain qui ecrit, et il attend une reponse. Les deux se completent —
 * error_log dit ce qui a casse, feedback dit ce qui derange.
 *
 * La reponse du support vit dans la meme ligne plutot que dans une table de
 * messages : un aller-retour suffit a l'usage vise. Passer a une vraie
 * conversation demanderait une table dediee, et cette colonne s'y migrerait
 * comme premier message.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('feedback', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());

    // Auteur du signalement. CASCADE : supprimer son compte doit effacer ce
    // qu'on a ecrit, c'est ce que promet la suppression de compte.
    table.uuid('user_id').notNullable().references('id').inTable('user').onDelete('CASCADE');
    // Organisation au moment de l'envoi, pour situer le signalement. SET NULL :
    // le signalement garde sa valeur meme si l'organisation disparait.
    table.uuid('organization_id').references('id').inTable('organization').onDelete('SET NULL');

    // 'bug' | 'suggestion'
    table.string('type', 20).notNullable();
    table.string('subject', 150).notNullable();
    table.text('message').notNullable();

    // 'new' | 'in_progress' | 'resolved' | 'declined'
    table.string('status', 20).notNullable().defaultTo('new');

    // Contexte technique, renseigne par le client : sans lui, un bug mobile est
    // irreproductible.
    // 'mobile' | 'web'
    table.string('platform', 20);
    table.string('app_version', 40);
    // Ecran ou page d'ou le signalement a ete envoye.
    table.string('screen', 200);
    // Langue dans laquelle le message est ecrit — c'est dans celle-la qu'il faut
    // repondre.
    table.string('locale', 5).notNullable().defaultTo('fr');

    // Reponse du support, visible par l'auteur dans l'application.
    table.text('response');
    table.uuid('responded_by').references('id').inTable('user').onDelete('SET NULL');
    table.timestamp('responded_at');

    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

    // La console support trie par statut puis par date : c'est la seule lecture
    // frequente de cette table.
    table.index(['status', 'created_at'], 'idx_feedback_status_created');
    table.index(['user_id'], 'idx_feedback_user');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTable('feedback');
};
