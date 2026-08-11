/**
 * Vue par-item : permet de marquer un step ou une emergency précis comme "lu"
 * sans toucher le tab-level last_viewed_at (chantier_view).
 * Comme ça la pastille sur une étape spécifique disparaît quand on ouvre CETTE
 * étape, pas quand on arrive sur le sous-onglet Étapes.
 */
exports.up = async function (knex) {
  await knex.schema.createTable('chantier_item_view', (table) => {
    table.uuid('user_id').notNullable().references('user.id').onDelete('CASCADE');
    table.string('item_type', 20).notNullable(); // 'step' | 'emergency'
    table.uuid('item_id').notNullable();
    table.timestamp('last_viewed_at').defaultTo(knex.fn.now()).notNullable();
    table.primary(['user_id', 'item_type', 'item_id']);
    table.index(['item_id']);
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('chantier_item_view');
};
