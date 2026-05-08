exports.up = function (knex) {
  return knex.schema.alterTable('chantier_step', (table) => {
    table.timestamp('validated_at');
    table.uuid('validated_by').references('id').inTable('user').onDelete('SET NULL');
    table.text('validation_comment');
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('chantier_step', (table) => {
    table.dropColumn('validation_comment');
    table.dropColumn('validated_by');
    table.dropColumn('validated_at');
  });
};
