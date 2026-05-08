exports.up = function (knex) {
  return knex.schema
    .createTable('chantier_template', (table) => {
      table.uuid('id').primary().defaultTo(knex.fn.uuid());
      table.uuid('organization_id').notNullable().references('id').inTable('organization').onDelete('CASCADE');
      table.uuid('created_by').notNullable().references('id').inTable('user').onDelete('CASCADE');
      table.string('name', 200).notNullable();
      table.text('description');
      table
        .enu('default_status', ['a_venir', 'en_cours', 'termine'], {
          useNative: true,
          existingType: true,
          enumName: 'chantier_status',
        })
        .notNullable()
        .defaultTo('a_venir');
      table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
      table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

      table.index('organization_id', 'idx_template_org');
    })
    .then(() =>
      knex.schema.createTable('chantier_template_step', (table) => {
        table.uuid('id').primary().defaultTo(knex.fn.uuid());
        table.uuid('template_id').notNullable().references('id').inTable('chantier_template').onDelete('CASCADE');
        table.string('name', 200).notNullable();
        table.integer('position').notNullable().defaultTo(0);
        table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();

        table.index(['template_id', 'position'], 'idx_template_step_pos');
      }),
    )
    .then(() =>
      knex.schema.createTable('chantier_template_substep', (table) => {
        table.uuid('id').primary().defaultTo(knex.fn.uuid());
        table.uuid('template_step_id').notNullable().references('id').inTable('chantier_template_step').onDelete('CASCADE');
        table.string('name', 300).notNullable();
        table.integer('position').notNullable().defaultTo(0);
        table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();

        table.index(['template_step_id', 'position'], 'idx_template_substep_pos');
      }),
    );
};

exports.down = function (knex) {
  return knex.schema
    .dropTableIfExists('chantier_template_substep')
    .then(() => knex.schema.dropTableIfExists('chantier_template_step'))
    .then(() => knex.schema.dropTableIfExists('chantier_template'));
};
