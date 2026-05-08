exports.up = async function (knex) {
  // Token de push registre par device. Un user peut avoir plusieurs devices,
  // donc plusieurs lignes par user_id. UNIQUE(token) car le meme token peut
  // pas exister sur deux users.
  await knex.schema.createTable('push_token', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('user_id').notNullable().references('id').inTable('user').onDelete('CASCADE');
    table.string('token', 500).notNullable().unique();
    table.string('platform', 20); // 'ios' | 'android' | 'web'
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.index(['user_id'], 'idx_push_token_user');
  });

  // Toggle global ON/OFF des notifications pour un user.
  await knex.schema.alterTable('user', (table) => {
    table.boolean('push_enabled').notNullable().defaultTo(true);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('user', (table) => {
    table.dropColumn('push_enabled');
  });
  await knex.schema.dropTableIfExists('push_token');
};
