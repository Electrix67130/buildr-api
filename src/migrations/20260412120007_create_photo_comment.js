exports.up = function (knex) {
  return knex.schema.createTable('photo_comment', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('photo_id').notNullable().references('id').inTable('photo').onDelete('CASCADE');
    table.uuid('author_id').notNullable().references('id').inTable('user').onDelete('CASCADE');
    table.text('content').notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('photo_comment');
};
