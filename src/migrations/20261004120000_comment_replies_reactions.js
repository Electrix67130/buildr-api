/**
 * Repondre a un message precis, et y reagir d'un emoji.
 *
 * `comment.reply_to_id` designe le message cite. Si celui-ci est supprime, la
 * reponse reste et perd simplement sa citation (SET NULL) : on ne supprime pas
 * la parole de quelqu'un parce qu'un autre a retire la sienne.
 *
 * `comment_reaction` : une ligne par personne, par message et par emoji. La
 * contrainte d'unicite fait de l'ajout un geste idempotent et de la reaction
 * un interrupteur : reagir deux fois du meme emoji retire la reaction.
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('comment', (table) => {
    table.uuid('reply_to_id').nullable().references('id').inTable('comment').onDelete('SET NULL');
    table.index(['reply_to_id'], 'idx_comment_reply_to');
  });
  await knex.schema.createTable('comment_reaction', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('comment_id').notNullable().references('id').inTable('comment').onDelete('CASCADE');
    table.uuid('user_id').notNullable().references('id').inTable('user').onDelete('CASCADE');
    table.string('emoji', 16).notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.unique(['comment_id', 'user_id', 'emoji'], 'uq_comment_reaction');
    table.index(['comment_id'], 'idx_comment_reaction_comment');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTable('comment_reaction');
  await knex.schema.alterTable('comment', (table) => {
    table.dropIndex(['reply_to_id'], 'idx_comment_reply_to');
    table.dropColumn('reply_to_id');
  });
};
