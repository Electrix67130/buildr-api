exports.up = function (knex) {
  return knex.schema.createTable('chantier_template_member', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('template_id').notNullable().references('id').inTable('chantier_template').onDelete('CASCADE');
    table.uuid('user_id').notNullable().references('id').inTable('user').onDelete('CASCADE');
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.unique(['template_id', 'user_id']);
    table.index(['template_id'], 'idx_template_member_template');
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('chantier_template_member');
};
