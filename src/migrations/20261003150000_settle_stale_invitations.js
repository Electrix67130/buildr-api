/**
 * Solde les invitations restees « en attente » alors que la personne est deja
 * membre de l'organisation.
 *
 * Avant le rattachement a la connexion et la reinvitation qui remplace la
 * precedente, une invitation pouvait rester `pending` pour toujours : celle
 * d'une salariee reinvitee apres expiration de la premiere, par exemple. La
 * liste « en attente » la montrait a cote de son nom dans l'equipe.
 *
 * Reprise de donnees pure, sans changement de schema.
 */

exports.up = async function (knex) {
  const settled = await knex.raw(`
    update invitation i
       set status = 'accepted'
     where i.status = 'pending'
       and exists (
         select 1 from organization_member om
         join "user" u on u.id = om.user_id
        where om.organization_id = i.organization_id
          and lower(u.email) = lower(i.email)
       )
  `);
  console.log(`[invitation] ${settled.rowCount} invitation(s) soldee(s) : la personne etait deja membre`);
};

exports.down = async function () {
  // Rien a defaire : on ne sait pas lesquelles etaient restees en attente par erreur.
};
