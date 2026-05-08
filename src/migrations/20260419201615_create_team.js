exports.up = function (knex) {
  return knex.schema.createTable('team_member', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('manager_id').notNullable().references('id').inTable('user').onDelete('CASCADE');
    table.uuid('user_id').notNullable().references('id').inTable('user').onDelete('CASCADE');
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();

    table.unique(['manager_id', 'user_id']);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('team_member');
};
