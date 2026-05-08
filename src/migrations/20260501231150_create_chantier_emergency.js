exports.up = function (knex) {
  return knex.schema.createTable('chantier_emergency', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('chantier_id').notNullable().references('id').inTable('chantier').onDelete('CASCADE');
    table.uuid('created_by').notNullable().references('id').inTable('user').onDelete('CASCADE');
    table.string('photo_url', 1000);
    table.string('thumbnail_url', 1000);
    table.decimal('latitude', 10, 7);
    table.decimal('longitude', 10, 7);
    table.text('description');
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.index(['chantier_id', 'created_at'], 'idx_emergency_chantier_created');
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('chantier_emergency');
};
