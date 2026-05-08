exports.up = function (knex) {
  return knex.schema
    .raw(`CREATE TYPE chantier_member_role AS ENUM ('responsable', 'ouvrier', 'client')`)
    .then(() =>
      knex.schema.createTable('chantier_member', (table) => {
        table.uuid('id').primary().defaultTo(knex.fn.uuid());
        table.uuid('chantier_id').notNullable().references('id').inTable('chantier').onDelete('CASCADE');
        table.uuid('user_id').notNullable().references('id').inTable('user').onDelete('CASCADE');
        table
          .enu('role', ['responsable', 'ouvrier', 'client'], {
            useNative: true,
            existingType: true,
            enumName: 'chantier_member_role',
          })
          .notNullable()
          .defaultTo('ouvrier');
        table.boolean('can_view_comments').notNullable().defaultTo(true);
        table.boolean('can_view_photos').notNullable().defaultTo(true);
        table.boolean('can_view_documents').notNullable().defaultTo(true);
        table.boolean('can_view_reports').notNullable().defaultTo(true);
        table.boolean('can_edit').notNullable().defaultTo(false);
        table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
        table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

        table.unique(['chantier_id', 'user_id']);
      }),
    );
};

exports.down = function (knex) {
  return knex.schema
    .dropTable('chantier_member')
    .then(() => knex.schema.raw('DROP TYPE IF EXISTS chantier_member_role'));
};
