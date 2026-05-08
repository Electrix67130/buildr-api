exports.up = function (knex) {
  return knex.schema.alterTable('chantier_member', (table) => {
    table.boolean('can_view_steps').notNullable().defaultTo(true);
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('chantier_member', (table) => {
    table.dropColumn('can_view_steps');
  });
};
