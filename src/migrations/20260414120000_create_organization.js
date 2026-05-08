exports.up = async function (knex) {
  // 1. Create organization table
  await knex.schema.createTable('organization', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.string('name', 200).notNullable();
    table.uuid('created_by').references('id').inTable('user');
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
  });

  // 2. Add organization_id to user, chantier, invitation (nullable first)
  await knex.schema.alterTable('user', (table) => {
    table.uuid('organization_id').references('id').inTable('organization').onDelete('CASCADE');
  });
  await knex.schema.alterTable('chantier', (table) => {
    table.uuid('organization_id').references('id').inTable('organization').onDelete('CASCADE');
  });
  await knex.schema.alterTable('invitation', (table) => {
    table.uuid('organization_id').references('id').inTable('organization').onDelete('CASCADE');
  });

  // 3. Backfill: create one org per existing user, assign their chantiers
  const users = await knex('user').select('id', 'company_name', 'first_name', 'last_name');
  for (const u of users) {
    const orgName = u.company_name || `${u.first_name} ${u.last_name}`;
    const [org] = await knex('organization').insert({ name: orgName, created_by: u.id }).returning('id');
    await knex('user').where({ id: u.id }).update({ organization_id: org.id });
    // Assign all chantiers created by this user to their new org
    await knex('chantier').where({ created_by: u.id }).update({ organization_id: org.id });
  }

  // 4. Backfill invitations: use inviter's organization_id
  const invitations = await knex('invitation').select('id', 'invited_by');
  for (const inv of invitations) {
    const inviter = await knex('user').where({ id: inv.invited_by }).first();
    if (inviter?.organization_id) {
      await knex('invitation').where({ id: inv.id }).update({ organization_id: inviter.organization_id });
    }
  }

  // 5. Make organization_id NOT NULL on user and chantier
  await knex.schema.alterTable('user', (table) => {
    table.uuid('organization_id').notNullable().alter();
  });
  await knex.schema.alterTable('chantier', (table) => {
    table.uuid('organization_id').notNullable().alter();
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('invitation', (table) => {
    table.dropColumn('organization_id');
  });
  await knex.schema.alterTable('chantier', (table) => {
    table.dropColumn('organization_id');
  });
  await knex.schema.alterTable('user', (table) => {
    table.dropColumn('organization_id');
  });
  await knex.schema.dropTable('organization');
};
