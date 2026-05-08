exports.up = function (knex) {
  return knex.schema
    .raw(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'gestionnaire_reseau'`)
    .then(() => knex.schema.raw(`ALTER TYPE chantier_member_role ADD VALUE IF NOT EXISTS 'gestionnaire_reseau'`))
    .then(() =>
      knex.schema.alterTable('chantier_member', (table) => {
        table.boolean('can_view_team').notNullable().defaultTo(true);
      }),
    );
};

exports.down = function (knex) {
  // Note : Postgres ne sait pas DROP VALUE sur un enum. On laisse les valeurs inutilisees.
  return knex.schema.alterTable('chantier_member', (table) => {
    table.dropColumn('can_view_team');
  });
};
