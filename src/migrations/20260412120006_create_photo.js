exports.up = function (knex) {
  return knex.schema.createTable('photo', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('chantier_id').notNullable().references('id').inTable('chantier').onDelete('CASCADE');
    table.uuid('uploaded_by').notNullable().references('id').inTable('user').onDelete('CASCADE');
    table.string('url', 1000).notNullable();
    table.string('thumbnail_url', 1000);
    table.string('caption', 500);
    table.decimal('latitude', 10, 7);
    table.decimal('longitude', 10, 7);
    table.timestamp('taken_at');
    table.integer('file_size');
    table.string('mime_type', 50);
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.index(['chantier_id', 'created_at'], 'idx_photo_chantier');
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('photo');
};
