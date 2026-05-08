exports.up = async function (knex) {
  // Enum des onglets trackes : comments (Discussions), photos, documents, emergencies.
  await knex.schema.raw(
    `CREATE TYPE chantier_view_tab AS ENUM ('comments', 'photos', 'documents', 'emergencies')`,
  );

  await knex.schema.createTable('chantier_view', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('user_id').notNullable().references('id').inTable('user').onDelete('CASCADE');
    table.uuid('chantier_id').notNullable().references('id').inTable('chantier').onDelete('CASCADE');
    table
      .enu('tab', null, {
        useNative: true,
        existingType: true,
        enumName: 'chantier_view_tab',
      })
      .notNullable();
    table.timestamp('last_viewed_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.unique(['user_id', 'chantier_id', 'tab']);
    table.index(['user_id', 'chantier_id'], 'idx_chantier_view_user_chantier');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('chantier_view');
  await knex.schema.raw('DROP TYPE IF EXISTS chantier_view_tab');
};
