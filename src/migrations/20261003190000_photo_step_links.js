/**
 * Une photo peut etre rattachee a une etape ou a une sous-etape.
 *
 * Valider une etape sur le terrain, c'est souvent constater un etat : la
 * photo en est la preuve. Elle reste une photo du chantier comme les autres
 * (galerie, droits `view_photos`), avec en plus le lien vers ce qu'elle
 * atteste. La suppression de l'etape detache la photo sans la perdre.
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('photo', (table) => {
    table.uuid('step_id').nullable().references('id').inTable('chantier_step').onDelete('SET NULL');
    table.uuid('substep_id').nullable().references('id').inTable('chantier_substep').onDelete('SET NULL');
    table.index(['step_id'], 'idx_photo_step');
    table.index(['substep_id'], 'idx_photo_substep');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('photo', (table) => {
    table.dropIndex(['step_id'], 'idx_photo_step');
    table.dropIndex(['substep_id'], 'idx_photo_substep');
    table.dropColumn('step_id');
    table.dropColumn('substep_id');
  });
};
