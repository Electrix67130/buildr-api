// Retire la permission `can_view_reports` qui n'a jamais ete branchee a une vraie feature.
// Reservee initialement pour des rapports de chantier, mais aucune route/service ne la check.
exports.up = function (knex) {
  return knex.schema.alterTable('chantier_member', (table) => {
    table.dropColumn('can_view_reports');
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('chantier_member', (table) => {
    table.boolean('can_view_reports').notNullable().defaultTo(true);
  });
};
