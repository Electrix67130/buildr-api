exports.up = function (knex) {
  return knex.schema
    .raw(`CREATE TYPE document_type AS ENUM ('dict', 'dt', 'bon_de_commande', 'plan', 'arrete', 'facture', 'autre')`)
    .then(() =>
      knex.schema.createTable('document', (table) => {
        table.uuid('id').primary().defaultTo(knex.fn.uuid());
        table.uuid('chantier_id').notNullable().references('id').inTable('chantier').onDelete('CASCADE');
        table.uuid('uploaded_by').notNullable().references('id').inTable('user').onDelete('CASCADE');
        table.string('name', 300).notNullable();
        table
          .enu('type', ['dict', 'dt', 'bon_de_commande', 'plan', 'arrete', 'facture', 'autre'], {
            useNative: true,
            existingType: true,
            enumName: 'document_type',
          })
          .notNullable();
        table.string('url', 1000).notNullable();
        table.integer('file_size');
        table.string('mime_type', 100);
        table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
        table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

        table.index(['chantier_id', 'type'], 'idx_document_chantier_type');
      }),
    );
};

exports.down = function (knex) {
  return knex.schema
    .dropTable('document')
    .then(() => knex.schema.raw('DROP TYPE IF EXISTS document_type'));
};
