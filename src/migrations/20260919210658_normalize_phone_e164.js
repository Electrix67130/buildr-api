const { parsePhoneNumberFromString, isSupportedCountry } = require('libphonenumber-js');

/**
 * Reprise des telephones existants au format E.164 (`+33612345678`).
 *
 * Jusqu'ici la colonne acceptait n'importe quelle chaine : la meme personne
 * pouvait etre enregistree `06 12 34 56 78`, `0612345678` ou `06.12.34.56.78`
 * selon l'ecran de saisie. A partir de cette migration, les services
 * normalisent toute ecriture (voir `src/lib/phone.ts`) ; celle-ci met
 * l'existant au meme niveau.
 *
 * Non destructive : un numero qui ne se laisse pas interpreter est laisse tel
 * quel et signale dans la sortie de la migration, pour etre traite a la main.
 * On prefere un numero mal forme a un numero perdu.
 *
 * Pas de contrainte CHECK sur la colonne pour la meme raison : elle ne
 * pourrait etre posee tant qu'une seule ligne douteuse subsiste.
 */

const DEFAULT_COUNTRY = 'FR';

function toE164(value, country) {
  if (!value || !value.trim()) return null;
  const ref = country ? country.toUpperCase() : null;
  const parsed = parsePhoneNumberFromString(value.trim(), ref && isSupportedCountry(ref) ? ref : DEFAULT_COUNTRY);
  return parsed && parsed.isValid() ? parsed.number : null;
}

async function normalizeTable(knex, table, rows) {
  let changed = 0;
  const skipped = [];
  for (const row of rows) {
    const normalized = toE164(row.phone, row.country);
    if (!normalized) {
      skipped.push(`${table} ${row.id} : "${row.phone}"`);
      continue;
    }
    if (normalized === row.phone) continue;
    await knex(table).where({ id: row.id }).update({ phone: normalized });
    changed += 1;
  }
  console.log(`[phone] ${table} : ${changed} numero(s) normalise(s), ${skipped.length} laisse(s) tel(s) quel(s)`);
  for (const line of skipped) console.log(`[phone]   non interprete -> ${line}`);
}

exports.up = async function (knex) {
  const orgs = await knex('organization').whereNotNull('phone').select('id', 'phone', 'country');
  await normalizeTable(knex, 'organization', orgs);

  // Le pays de reference d'un utilisateur est celui de son organisation active.
  const users = await knex('user')
    .whereNotNull('user.phone')
    .leftJoin('organization', 'organization.id', knex.raw('coalesce("user".active_organization_id, "user".organization_id)'))
    .select('user.id', 'user.phone', 'organization.country');
  await normalizeTable(knex, 'user', users);
};

// Les formats d'origine n'ont pas ete conserves : un E.164 reste un numero
// valide et lisible, on ne revient pas en arriere.
exports.down = async function () {};
