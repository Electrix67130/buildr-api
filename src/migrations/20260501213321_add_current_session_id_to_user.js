exports.up = function (knex) {
  return knex.schema.alterTable('user', (table) => {
    table.string('current_session_id', 64);
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('user', (table) => {
    table.dropColumn('current_session_id');
  });
};
