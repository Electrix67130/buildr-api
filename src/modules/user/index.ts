import fp from 'fastify-plugin';
import { z } from 'zod';
import UserService from './user.service';
import { updateUserSchema, deleteAccountSchema, toPublicUser } from './user.schema';
import { getUserOrganizationId } from '@/lib/org-scope';
import { getActiveMembership } from '@/lib/active-membership';

const searchSchema = z.object({
  q: z.string().min(1).max(100),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  orderBy: z.string().optional().default('created_at'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
});

const uuidSchema = z.object({ id: z.string().uuid() });

// Fields that any user can update on their own profile
const SELF_EDITABLE_FIELDS = ['first_name', 'last_name', 'email', 'phone', 'avatar_url', 'locale'] as const;
// Fields reserved to admins (role, is_active, company_name)
const ADMIN_ONLY_FIELDS = ['role', 'is_active', 'company_name'] as const;

export default fp(
  (fastify, _opts, done) => {
    const service = new UserService(fastify.db);

    /**
     * Membership de `targetId` dans l'organisation active de `viewerId`.
     *
     * `undefined` signifie que les deux ne partagent aucune organisation — et
     * dans ce cas la cible doit etre traitee comme inexistante. Buildr est
     * multi-locataire : deux entreprises concurrentes peuvent avoir un compte,
     * et rien de l'une ne doit etre atteignable depuis l'autre.
     */
    const sharedMembership = async (viewerOrgId: string | undefined, targetId: string) => {
      if (!viewerOrgId) return undefined;
      return fastify.db('organization_member').where({ user_id: targetId, organization_id: viewerOrgId }).first();
    };

    /**
     * Refuse un changement qui laisserait l'organisation sans aucun administrateur.
     *
     * Sans ce garde-fou, l'unique admin peut se retrograder — ou etre supprime —
     * et plus personne ne peut inviter, gerer les comptes ni creer de chantier.
     * L'API n'offre aucune voie de retour : il faudrait un acces direct a la base.
     */
    const wouldLeaveOrgWithoutAdmin = async (orgId: string, targetCurrentRole: string | undefined) => {
      if (targetCurrentRole !== 'admin') return false;
      const [{ count }] = (await fastify.db('organization_member')
        .where({ organization_id: orgId, role: 'admin' })
        .count('* as count')) as { count: string }[];
      return parseInt(count, 10) <= 1;
    };

    // GET /users — visibility scoped by role:
    // - admin: all org users
    // - manager: their team members
    // - employee/client: chantier co-members only
    fastify.get('/users', { preHandler: [fastify.authenticate] }, async (request) => {
      const pagination = paginationSchema.parse(request.query);
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (!membership) return { data: [], meta: { total: 0, page: 1, limit: 0, totalPages: 0 } };
      const orgId = membership.organization_id;

      if (membership.role === 'admin') {
        return service.findByOrganization(orgId, pagination);
      }

      if (membership.role === 'manager') {
        return service.findTeamMembers(request.user.sub, orgId, pagination);
      }

      return service.findCoMembers(request.user.sub, orgId, pagination);
    });

    // GET /users/search — within current user's organization
    fastify.get('/users/search', { preHandler: [fastify.authenticate] }, async (request) => {
      const { q, ...pagination } = searchSchema.parse(request.query);
      const orgId = await getUserOrganizationId(fastify.db, request.user.sub);
      return service.search({ query: q, organizationId: orgId, ...pagination });
    });

    // GET /users/:id — un membre de son organisation, ou soi-meme
    fastify.get('/users/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const user = await service.findById(id);
      if (!user) return reply.notFound('User not found');

      const viewer = await getActiveMembership(fastify.db, request.user.sub);
      const membership = await sharedMembership(viewer?.organization_id, id);

      // Cette route ne verifiait rien : n'importe quel compte authentifie lisait
      // le profil complet de n'importe qui — adresse, telephone, societe —
      // toutes organisations confondues. On repond 404 plutot que 403 : dire
      // « interdit » confirmerait que l'identifiant existe.
      if (!membership && id !== request.user.sub) return reply.notFound('User not found');

      const safeUser = toPublicUser(user);
      // findById lit la table user, dont la colonne `role` est un vestige : la
      // source de verite est organization_member. Sans cette reprise, la fiche
      // affichait un role different de celui de la liste (qui, elle, joint
      // organization_member) et different des droits reellement appliques.
      if (membership) safeUser.role = membership.role;
      return safeUser;
    });

    // PATCH /users/:id — self update OR admin for role/is_active
    fastify.patch('/users/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const data = updateUserSchema.parse(request.body);

      const currentUser = await service.findById(request.user.sub);
      if (!currentUser) return reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid user' });

      const targetUser = id === request.user.sub ? currentUser : await service.findById(id);
      if (!targetUser) return reply.notFound('User not found');

      const editorMembership = await getActiveMembership(fastify.db, request.user.sub);
      const isSelf = request.user.sub === id;
      const isAdmin = editorMembership?.role === 'admin';

      const targetMembership = await sharedMembership(editorMembership?.organization_id, id);

      // Seul le champ `role` etait cloisonne. Tout le reste ne l'etait pas : un
      // admin de l'organisation A qui connaissait un identifiant de
      // l'organisation B pouvait desactiver ce compte, changer son adresse — et,
      // via la cascade sur company_name plus bas, renommer sa PROPRE
      // organisation au passage, puisque celle-ci est indexee sur l'editeur.
      if (!isSelf && !targetMembership) return reply.notFound('User not found');

      const targetIsClient = targetMembership?.role === 'client';

      // Non-admins can only update themselves and only SELF_EDITABLE_FIELDS
      if (!isAdmin && !isSelf) {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Cannot modify other users' });
      }

      // Non-admins peuvent modifier les champs admin-only uniquement dans un cas :
      // un client edite SON PROPRE company_name (sa societe a lui, distincte de l'org).
      if (!isAdmin) {
        for (const field of ADMIN_ONLY_FIELDS) {
          if (field in data) {
            const clientEditingOwnCompany = field === 'company_name' && isSelf && targetIsClient;
            if (clientEditingOwnCompany) continue;
            return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: `Only admins can modify '${field}'` });
          }
        }
      }

      // Le role vit sur organization_member : c'est lui que lisent
      // getActiveMembership() et donc tous les controles d'acces. L'ecrire sur
      // user.role ne changeait aucun droit — l'admin croyait avoir promu ou
      // retrograde quelqu'un sans que rien ne bouge. On met les deux a jour :
      // la membership fait autorite, la colonne user suit pour ne pas diverger.
      const { role: newRole, ...userFields } = data;

      if (newRole && editorMembership?.organization_id) {
        if (newRole !== 'admin' && (await wouldLeaveOrgWithoutAdmin(editorMembership.organization_id, targetMembership?.role))) {
          return reply.code(409).send({
            statusCode: 409,
            error: 'Conflict',
            message: "Votre organisation doit garder au moins un administrateur. Nommez-en un autre avant de retirer ce role.",
          });
        }

        const updated = await fastify.db('organization_member')
          .where({ user_id: id, organization_id: editorMembership.organization_id })
          .update({ role: newRole, updated_at: fastify.db.fn.now() });
        if (updated === 0) {
          return reply.notFound("Cet utilisateur n'est pas membre de votre organisation");
        }
      }

      const user = await service.update(id, newRole ? { ...userFields, role: newRole } : userFields);
      if (!user) return reply.notFound('User not found');

      // L'admin qui change company_name d'un membre interne (non-client) propage a toute l'org.
      // Si la cible est un client, c'est la societe du client (pas le nom de l'org) → pas de cascade.
      if (isAdmin && data.company_name && editorMembership?.organization_id && !targetIsClient) {
        const orgId = editorMembership.organization_id;
        // Met a jour company_name pour tous les users non-client dans l'org via organization_member.
        const nonClientMembers = (await fastify.db('organization_member')
          .where({ organization_id: orgId })
          .whereNot('role', 'client')
          .select('user_id')) as { user_id: string }[];
        if (nonClientMembers.length > 0) {
          await fastify.db('user')
            .whereIn('id', nonClientMembers.map((m) => m.user_id))
            .update({ company_name: data.company_name });
        }
        await fastify.db('organization')
          .where('id', orgId)
          .update({ name: data.company_name });
      }

      const safeUser = toPublicUser(user);
      if (editorMembership?.organization_id) {
        const membership = await fastify.db('organization_member')
          .where({ user_id: id, organization_id: editorMembership.organization_id })
          .first();
        if (membership) safeUser.role = membership.role;
      }
      return safeUser;
    });

    // DELETE /users/me — suppression de son propre compte (exigence Apple 5.1.1(v)).
    // Declaree avant /users/:id : le segment statique doit primer sur le parametre.
    fastify.delete('/users/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { password } = deleteAccountSchema.parse(request.body);
      await service.deleteOwnAccount(request.user.sub, password);
      return reply.code(204).send();
    });

    // DELETE /users/:id — admin de l'organisation de la cible, uniquement
    fastify.delete('/users/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (membership?.role !== 'admin') {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
      }
      const { id } = uuidSchema.parse(request.params);

      // Le role d'admin ne valait que dans SA propre organisation, mais la route
      // ne le verifiait pas : un admin pouvait supprimer le compte de n'importe
      // qui, dans n'importe quelle entreprise, en connaissant son identifiant.
      const targetMembership = await sharedMembership(membership.organization_id, id);
      if (!targetMembership) return reply.notFound('User not found');

      if (await wouldLeaveOrgWithoutAdmin(membership.organization_id, targetMembership.role)) {
        return reply.code(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: "Votre organisation doit garder au moins un administrateur. Nommez-en un autre avant de supprimer ce compte.",
        });
      }

      const deleted = await service.delete(id);
      if (!deleted) return reply.notFound('User not found');
      return reply.code(204).send();
    });

    done();
  },
  { name: 'user-module' },
);
