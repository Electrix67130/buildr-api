/**
 * Reglages fins des notifications.
 *
 * Jusqu'ici, un seul interrupteur (`user.push_enabled`) : tout ou rien. Sur
 * plusieurs chantiers actifs, chaque photo et chaque message de chacun sonnait,
 * et la seule defense etait de tout couper — mentions et urgences comprises.
 *
 * - `user.notification_prefs` : une valeur par categorie (messages, photos…).
 *   Une categorie absente est active : rien ne change pour les comptes existants.
 * - `chantier_notification_level` : le reglage d'un chantier, quand il n'est pas
 *   « tout ». Une ligne n'existe que pour un chantier mis en sourdine.
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('user', (table) => {
    table.jsonb('notification_prefs').notNullable().defaultTo('{}');
  });

  await knex.schema.createTable('chantier_notification_level', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('user_id').notNullable().references('id').inTable('user').onDelete('CASCADE');
    table.uuid('chantier_id').notNullable().references('id').inTable('chantier').onDelete('CASCADE');
    // 'important' : mentions et urgences seulement. 'none' : rien du tout.
    table.string('level', 16).notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    table.unique(['user_id', 'chantier_id'], 'uq_chantier_notification_level');
    table.index(['chantier_id'], 'idx_chantier_notification_level_chantier');
  });
  await knex.raw(
    "ALTER TABLE chantier_notification_level ADD CONSTRAINT chk_chantier_notification_level CHECK (level IN ('important', 'none'))",
  );
};

exports.down = async function (knex) {
  await knex.schema.dropTable('chantier_notification_level');
  await knex.schema.alterTable('user', (table) => {
    table.dropColumn('notification_prefs');
  });
};
