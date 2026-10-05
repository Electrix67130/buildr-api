/**
 * Blocage entre utilisateurs : les messages et photos de la personne bloquee
 * disparaissent pour celui qui bloque, et pour lui seul. La personne bloquee
 * n'en est pas informee, reste dans l'equipe et continue de travailler.
 *
 * C'est le pendant du signalement : le signalement remonte a l'administrateur,
 * le blocage protege tout de suite celui qui ne veut plus lire quelqu'un.
 */

exports.up = async function (knex) {
  await knex.schema.createTable('user_block', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('blocker_id').notNullable().references('id').inTable('user').onDelete('CASCADE');
    table.uuid('blocked_id').notNullable().references('id').inTable('user').onDelete('CASCADE');
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.unique(['blocker_id', 'blocked_id'], 'uq_user_block');
    table.index(['blocker_id'], 'idx_user_block_blocker');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTable('user_block');
};
