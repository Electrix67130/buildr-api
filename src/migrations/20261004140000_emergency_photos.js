/**
 * Plusieurs photos par urgence.
 *
 * Une urgence ne portait qu'une photo (`photo_url`). Ses photos rejoignent la
 * table `photo`, rattachees par `emergency_id`, comme celles des etapes : une
 * seule galerie, un seul stockage, les memes vignettes. La suppression de
 * l'urgence emporte ses photos (CASCADE). `photo_url` est conserve et garde la
 * premiere photo, pour les clients qui ne lisent pas encore `photos`.
 *
 * Reprise : chaque photo existante devient une ligne de `photo`.
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('photo', (table) => {
    table.uuid('emergency_id').nullable().references('id').inTable('chantier_emergency').onDelete('CASCADE');
    table.index(['emergency_id'], 'idx_photo_emergency');
  });
  const res = await knex.raw(`
    insert into photo (chantier_id, uploaded_by, url, thumbnail_url, emergency_id, created_at, updated_at)
    select e.chantier_id, e.created_by, e.photo_url, e.thumbnail_url, e.id, e.created_at, e.created_at
      from chantier_emergency e
     where e.photo_url is not null
       and not exists (select 1 from photo p where p.emergency_id = e.id)
  `);
  console.log(`[emergency] ${res.rowCount} photo(s) d'urgence reprise(s) dans la galerie`);
};

exports.down = async function (knex) {
  await knex('photo').whereNotNull('emergency_id').del();
  await knex.schema.alterTable('photo', (table) => {
    table.dropIndex(['emergency_id'], 'idx_photo_emergency');
    table.dropColumn('emergency_id');
  });
};
