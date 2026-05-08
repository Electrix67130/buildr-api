exports.up = async function (knex) {
  // 1. Create organization_member table — multi-org membership avec role par org.
  // On reutilise l'enum user_role qui a deja toutes les valeurs (admin, manager, employee, client, gestionnaire_reseau).
  await knex.schema.createTable('organization_member', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('organization_id').notNullable().references('id').inTable('organization').onDelete('CASCADE');
    table.uuid('user_id').notNullable().references('id').inTable('user').onDelete('CASCADE');
    table
      .enu('role', null, {
        useNative: true,
        existingType: true,
        enumName: 'user_role',
      })
      .notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.unique(['organization_id', 'user_id']);
    table.index(['user_id'], 'idx_org_member_user');
    table.index(['organization_id'], 'idx_org_member_org');
  });

  // 2. Add active_organization_id to user (nullable pour l'instant — backfill suit).
  await knex.schema.alterTable('user', (table) => {
    table.uuid('active_organization_id').references('id').inTable('organization').onDelete('SET NULL');
  });

  // 3. Backfill : copier l'org actuelle de chaque user dans organization_member, set comme active.
  const users = await knex('user').select('id', 'organization_id', 'role');
  for (const u of users) {
    if (!u.organization_id) continue;
    await knex('organization_member')
      .insert({
        organization_id: u.organization_id,
        user_id: u.id,
        role: u.role,
      })
      .onConflict(['organization_id', 'user_id'])
      .ignore();
    await knex('user').where({ id: u.id }).update({ active_organization_id: u.organization_id });
  }
};

exports.down = async function (knex) {
  await knex.schema.alterTable('user', (table) => {
    table.dropColumn('active_organization_id');
  });
  await knex.schema.dropTableIfExists('organization_member');
};
