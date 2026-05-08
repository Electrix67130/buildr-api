exports.up = function (knex) {
  return knex.schema
    .createTable('chantier_step', (table) => {
      table.uuid('id').primary().defaultTo(knex.fn.uuid());
      table.uuid('chantier_id').notNullable().references('id').inTable('chantier').onDelete('CASCADE');
      table.string('name', 200).notNullable();
      table.integer('position').notNullable().defaultTo(0);
      table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
      table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

      table.index(['chantier_id', 'position'], 'idx_chantier_step_chantier_position');
    })
    .then(() =>
      knex.schema.createTable('chantier_substep', (table) => {
        table.uuid('id').primary().defaultTo(knex.fn.uuid());
        table.uuid('step_id').notNullable().references('id').inTable('chantier_step').onDelete('CASCADE');
        table.string('name', 300).notNullable();
        table.integer('position').notNullable().defaultTo(0);
        table.timestamp('validated_at');
        table.uuid('validated_by').references('id').inTable('user').onDelete('SET NULL');
        table.text('validation_comment');
        table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
        table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

        table.index(['step_id', 'position'], 'idx_chantier_substep_step_position');
      }),
    );
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('chantier_substep').then(() => knex.schema.dropTableIfExists('chantier_step'));
};
