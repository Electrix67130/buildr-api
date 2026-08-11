/**
 * Ajoute les informations légales et de contact à l'organisation.
 * Pas d'infos bancaires : c'est Stripe qui gérera l'IBAN/cartes via son Customer Portal.
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('organization', (table) => {
    // Identification légale
    table.string('siret', 14);
    table.string('legal_form', 50);
    table.string('vat_number', 30);
    table.string('naf_code', 10);

    // Adresse du siège
    table.string('address', 500);
    table.string('postal_code', 10);
    table.string('city', 100);
    table.string('country', 2).defaultTo('FR');

    // Contact
    table.string('phone', 20);
    table.string('billing_email', 255);
    table.string('website', 500);

    // Branding
    table.string('logo_url', 500);

    // Assurance décennale (obligatoire pour la plupart des activités BTP)
    table.string('insurance_provider', 200);
    table.string('insurance_number', 100);

    table.index('siret');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('organization', (table) => {
    table.dropIndex('siret');
    table.dropColumn('siret');
    table.dropColumn('legal_form');
    table.dropColumn('vat_number');
    table.dropColumn('naf_code');
    table.dropColumn('address');
    table.dropColumn('postal_code');
    table.dropColumn('city');
    table.dropColumn('country');
    table.dropColumn('phone');
    table.dropColumn('billing_email');
    table.dropColumn('website');
    table.dropColumn('logo_url');
    table.dropColumn('insurance_provider');
    table.dropColumn('insurance_number');
  });
};
