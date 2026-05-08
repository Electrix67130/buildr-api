exports.up = function (knex) {
  return knex.schema.alterTable('comment', (table) => {
    table.uuid('step_id').references('id').inTable('chantier_step').onDelete('SET NULL');
    table.index(['chantier_id', 'step_id'], 'idx_comment_chantier_step');
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('comment', (table) => {
    table.dropIndex(['chantier_id', 'step_id'], 'idx_comment_chantier_step');
    table.dropColumn('step_id');
  });
};
