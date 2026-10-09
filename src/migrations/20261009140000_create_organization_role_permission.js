/**
 * Droits par defaut de chaque role sur un chantier, propres a une organisation.
 *
 * Ils etaient ecrits dans le code, les memes pour toutes les entreprises. Or
 * chacune decide de ce qu'un ouvrier, un client ou un gestionnaire reseau voit
 * en arrivant sur un chantier. Une ligne n'existe que pour un role personnalise :
 * sans elle, les valeurs du code s'appliquent.
 */

exports.up = async function (knex) {
  await knex.schema.createTable('organization_role_permission', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('organization_id').notNullable().references('id').inTable('organization').onDelete('CASCADE');
    table.string('role', 32).notNullable();
    table.boolean('can_view_comments').notNullable();
    table.boolean('can_view_photos').notNullable();
    table.boolean('can_view_documents').notNullable();
    table.boolean('can_view_steps').notNullable();
    table.boolean('can_view_team').notNullable();
    table.boolean('can_edit').notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    table.unique(['organization_id', 'role'], 'uq_organization_role_permission');
  });
  await knex.raw(
    "ALTER TABLE organization_role_permission ADD CONSTRAINT chk_organization_role_permission_role CHECK (role IN ('manager', 'ouvrier', 'client', 'gestionnaire_reseau'))",
  );
};

exports.down = async function (knex) {
  await knex.schema.dropTable('organization_role_permission');
};
