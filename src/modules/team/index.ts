import fp from 'fastify-plugin';
import { z } from 'zod';
import TeamService from './team.service';
import { addTeamMemberSchema } from './team.schema';
import { getActiveMembership } from '@/lib/active-membership';

const uuidSchema = z.object({ id: z.string().uuid() });
const managerIdSchema = z.object({ manager_id: z.string().uuid() });

export default fp(
  (fastify, _opts, done) => {
    const service = new TeamService(fastify.db);

    /**
     * Ce module lisait la colonne vestigiale `user.role`, globale, plutot que
     * `organization_member.role`, qui est la source de verite des droits. Deux
     * consequences : le role affiche pouvait diverger de celui reellement
     * applique des qu'une personne appartient a deux organisations, et surtout
     * deux routes ne verifiaient aucune organisation — un admin lisait et
     * defaisait les equipes de n'importe quelle entreprise.
     */
    const memberOfSameOrg = async (viewerOrgId: string | undefined, targetId: string) => {
      if (!viewerOrgId) return undefined;
      return fastify.db('organization_member').where({ user_id: targetId, organization_id: viewerOrgId }).first();
    };

    // GET /teams/:manager_id — get a manager's team
    fastify.get('/teams/:manager_id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { manager_id } = managerIdSchema.parse(request.params);
      const viewer = await getActiveMembership(fastify.db, request.user.sub);
      const isSelf = request.user.sub === manager_id;

      // Un chef de chantier consulte la sienne ; un admin, celles de SON
      // organisation. Une equipe d'ailleurs est traitee comme inexistante.
      if (!isSelf) {
        if (viewer?.role !== 'admin') {
          return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Access denied' });
        }
        if (!(await memberOfSameOrg(viewer.organization_id, manager_id))) {
          return reply.notFound('Team not found');
        }
      }

      const members = await service.getTeam(manager_id);
      return { data: members };
    });

    // POST /teams — add a user to a manager's team (admin only)
    fastify.post('/teams', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const editor = await getActiveMembership(fastify.db, request.user.sub);
      if (editor?.role !== 'admin') {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
      }

      const { manager_id, user_id } = addTeamMemberSchema.parse(request.body);

      // Les deux doivent etre membres de l'organisation de l'editeur, et le
      // role se lit sur la membership : c'est elle qui fait foi.
      const managerMembership = await memberOfSameOrg(editor.organization_id, manager_id);
      const memberMembership = await memberOfSameOrg(editor.organization_id, user_id);

      if (!managerMembership || !memberMembership) {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Users must be in the same organization' });
      }
      if (managerMembership.role !== 'manager') {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'Target user is not a manager' });
      }

      // Check not already in team
      const existing = await service.findOne(manager_id, user_id);
      if (existing) {
        return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'Already in this team' });
      }

      const member = await service.addMember(manager_id, user_id);
      return reply.code(201).send(member);
    });

    // DELETE /teams/:id — remove from team (admin only)
    fastify.delete('/teams/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const editor = await getActiveMembership(fastify.db, request.user.sub);
      if (editor?.role !== 'admin') {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
      }

      const { id } = uuidSchema.parse(request.params);

      // Le rattachement doit appartenir a l'organisation de l'editeur : cette
      // route ne verifiait rien, un admin defaisait les equipes de n'importe
      // quelle entreprise en connaissant un identifiant.
      const lien = (await fastify.db('team_member').where({ id }).first()) as
        | { manager_id: string }
        | undefined;
      if (!lien || !(await memberOfSameOrg(editor.organization_id, lien.manager_id))) {
        return reply.notFound('Team member not found');
      }

      const deleted = await service.removeMember(id);
      if (!deleted) return reply.notFound('Team member not found');
      return reply.code(204).send();
    });

    done();
  },
  { name: 'team-module' },
);
