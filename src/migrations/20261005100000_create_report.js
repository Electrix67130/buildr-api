/**
 * Signalements : un message, une photo ou un membre que quelqu'un juge
 * deplace, remonte a l'administrateur de l'organisation.
 *
 * La cible est designee par son type et son identifiant, sans cle etrangere :
 * elle peut etre supprimee — c'est souvent l'issue — et le signalement doit
 * survivre pour garder trace de ce qui a ete fait. `target_excerpt` fige ce
 * qu'elle contenait au moment du signalement, pour la meme raison.
 *
 * `escalated` : la personne visee est administrateur de l'organisation. Les
 * autres administrateurs voient le signalement, jamais la personne visee, et
 * il remonte aussi a la console super admin, au cas ou l'organisation n'a
 * qu'un administrateur.
 */

exports.up = async function (knex) {
  await knex.schema.createTable('report', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('organization_id').notNullable().references('id').inTable('organization').onDelete('CASCADE');
    table.uuid('chantier_id').nullable().references('id').inTable('chantier').onDelete('CASCADE');
    table.uuid('reporter_id').notNullable().references('id').inTable('user').onDelete('CASCADE');
    table.string('target_type', 20).notNullable(); // comment | photo | user
    table.uuid('target_id').notNullable();
    table.uuid('target_user_id').nullable().references('id').inTable('user').onDelete('SET NULL');
    table.text('target_excerpt').nullable();
    table.string('reason', 30).notNullable(); // inappropriate | harassment | off_topic | other
    table.text('comment').nullable();
    table.string('status', 20).notNullable().defaultTo('pending'); // pending | resolved | dismissed
    table.boolean('escalated').notNullable().defaultTo(false);
    table.uuid('resolved_by').nullable().references('id').inTable('user').onDelete('SET NULL');
    table.timestamp('resolved_at').nullable();
    table.text('resolution_note').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    table.index(['organization_id', 'status'], 'idx_report_org_status');
    table.index(['target_type', 'target_id'], 'idx_report_target');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTable('report');
};
