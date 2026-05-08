exports.up = function (knex) {
  return knex.schema.createTable('comment', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('chantier_id').notNullable().references('id').inTable('chantier').onDelete('CASCADE');
    table.uuid('author_id').notNullable().references('id').inTable('user').onDelete('CASCADE');
    table.text('content').notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.index(['chantier_id', 'created_at'], 'idx_comment_chantier');
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('comment');
};
