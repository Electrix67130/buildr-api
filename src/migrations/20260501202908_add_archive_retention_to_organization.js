exports.up = function (knex) {
  return knex.schema.alterTable('organization', (table) => {
    table.integer('archive_retention_years').notNullable().defaultTo(5);
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('organization', (table) => {
    table.dropColumn('archive_retention_years');
  });
};
