exports.up = function (knex) {
  return knex.schema
    .raw(`CREATE TYPE chantier_status AS ENUM ('a_venir', 'en_cours', 'termine')`)
    .then(() =>
      knex.schema.createTable('chantier', (table) => {
        table.uuid('id').primary().defaultTo(knex.fn.uuid());
        table.string('name', 200).notNullable();
        table.text('description');
        table.string('address', 500);
        table.string('city', 100);
        table.string('postal_code', 10);
        table.decimal('latitude', 10, 7);
        table.decimal('longitude', 10, 7);
        table
          .enu('status', ['a_venir', 'en_cours', 'termine'], {
            useNative: true,
            existingType: true,
            enumName: 'chantier_status',
          })
          .notNullable()
          .defaultTo('a_venir');
        table.date('start_date');
        table.date('end_date');
        table.uuid('created_by').notNullable().references('id').inTable('user');
        table.timestamp('archived_at');
        table.timestamp('auto_delete_at');
        table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
        table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

        table.index('status', 'idx_chantier_status');
        table.index(['latitude', 'longitude'], 'idx_chantier_coords');
      }),
    );
};

exports.down = function (knex) {
  return knex.schema
    .dropTable('chantier')
    .then(() => knex.schema.raw('DROP TYPE IF EXISTS chantier_status'));
};
