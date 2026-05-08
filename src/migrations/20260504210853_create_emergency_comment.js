exports.up = function (knex) {
  return knex.schema.createTable('emergency_comment', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('emergency_id').notNullable().references('id').inTable('chantier_emergency').onDelete('CASCADE');
    table.uuid('author_id').notNullable().references('id').inTable('user').onDelete('CASCADE');
    table.text('content').notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.index(['emergency_id', 'created_at'], 'idx_emergency_comment_emergency_created');
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('emergency_comment');
};
