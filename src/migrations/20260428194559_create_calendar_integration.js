exports.up = function (knex) {
  return knex.schema
    .raw(`CREATE TYPE calendar_provider AS ENUM ('google', 'outlook', 'apple')`)
    .then(() =>
      knex.schema.createTable('calendar_integration', (table) => {
        table.uuid('id').primary().defaultTo(knex.fn.uuid());
        table.uuid('user_id').notNullable().references('id').inTable('user').onDelete('CASCADE');
        table
          .enu('provider', ['google', 'outlook', 'apple'], {
            useNative: true,
            existingType: true,
            enumName: 'calendar_provider',
          })
          .notNullable();
        table.text('refresh_token_encrypted');
        table.string('external_calendar_id', 255);
        table.string('ical_token', 128);
        table.timestamp('last_sync_at');
        table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
        table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

        table.unique(['user_id', 'provider'], { indexName: 'uq_calendar_integration_user_provider' });
        table.unique(['ical_token'], { indexName: 'uq_calendar_integration_ical_token' });
        table.index('user_id', 'idx_calendar_integration_user_id');
      }),
    )
    .then(() =>
      knex.schema.createTable('calendar_event_link', (table) => {
        table.uuid('id').primary().defaultTo(knex.fn.uuid());
        table
          .uuid('integration_id')
          .notNullable()
          .references('id')
          .inTable('calendar_integration')
          .onDelete('CASCADE');
        table.uuid('chantier_id').notNullable().references('id').inTable('chantier').onDelete('CASCADE');
        table.string('external_event_id', 255).notNullable();
        table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
        table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

        table.unique(['integration_id', 'chantier_id'], { indexName: 'uq_calendar_event_link_integration_chantier' });
        table.index('chantier_id', 'idx_calendar_event_link_chantier_id');
      }),
    );
};

exports.down = function (knex) {
  return knex.schema
    .dropTableIfExists('calendar_event_link')
    .then(() => knex.schema.dropTableIfExists('calendar_integration'))
    .then(() => knex.schema.raw('DROP TYPE IF EXISTS calendar_provider'));
};
