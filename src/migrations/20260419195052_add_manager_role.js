exports.up = function (knex) {
  return knex.schema
    .raw(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'manager'`)
    .then(() =>
      knex.schema.raw(`ALTER TYPE chantier_member_role ADD VALUE IF NOT EXISTS 'manager'`),
    );
};

exports.down = function (knex) {
  // PostgreSQL does not support removing values from enums.
  // To fully revert, a new migration would need to recreate the types.
  return Promise.resolve();
};
