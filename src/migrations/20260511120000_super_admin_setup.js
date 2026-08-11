/**
 * Setup super admin :
 *  - flag is_super_admin sur user (mis à la main en SQL)
 *  - flag is_active sur organization (kill switch)
 *  - table audit_log (qui a fait quoi en tant que super_admin)
 *  - table error_log (Sentry maison)
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('user', (table) => {
    table.boolean('is_super_admin').notNullable().defaultTo(false).index();
  });

  await knex.schema.alterTable('organization', (table) => {
    table.boolean('is_active').notNullable().defaultTo(true);
  });

  await knex.schema.createTable('audit_log', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('super_admin_id').notNullable().references('user.id').onDelete('CASCADE');
    table.string('action', 100).notNullable();           // ex: 'org.disable', 'user.kick_sessions'
    table.string('target_type', 50);                      // ex: 'organization', 'user'
    table.uuid('target_id');                              // l'entité ciblée
    table.jsonb('metadata');                              // payload libre
    table.string('ip', 45);
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.index(['super_admin_id', 'created_at']);
    table.index(['target_type', 'target_id']);
  });

  await knex.schema.createTable('error_log', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.string('level', 10).notNullable();              // 'error' | 'warn'
    table.text('message').notNullable();
    table.text('stack');
    table.string('route', 500);
    table.string('method', 10);
    table.uuid('user_id').references('user.id').onDelete('SET NULL');
    table.integer('status_code');
    table.string('request_id', 100);
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable().index();
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('error_log');
  await knex.schema.dropTableIfExists('audit_log');
  await knex.schema.alterTable('organization', (table) => {
    table.dropColumn('is_active');
  });
  await knex.schema.alterTable('user', (table) => {
    table.dropColumn('is_super_admin');
  });
};
