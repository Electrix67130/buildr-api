import fp from 'fastify-plugin';
import { z } from 'zod';
import TeamService from './team.service';
import { addTeamMemberSchema } from './team.schema';
import { getUserOrganizationId } from '@/lib/org-scope';

const uuidSchema = z.object({ id: z.string().uuid() });
const managerIdSchema = z.object({ manager_id: z.string().uuid() });

export default fp(
  (fastify, _opts, done) => {
    const service = new TeamService(fastify.db);

    // GET /teams/:manager_id — get a manager's team
    fastify.get('/teams/:manager_id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { manager_id } = managerIdSchema.parse(request.params);
      const currentUser = await fastify.db('user').where({ id: request.user.sub }).first();

      // Admin can view any team, manager can view their own
      if (currentUser?.role !== 'admin' && request.user.sub !== manager_id) {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Access denied' });
      }

      const members = await service.getTeam(manager_id);
      return { data: members };
    });

    // POST /teams — add a user to a manager's team (admin only)
    fastify.post('/teams', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const currentUser = await fastify.db('user').where({ id: request.user.sub }).first();
      if (currentUser?.role !== 'admin') {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
      }

      const { manager_id, user_id } = addTeamMemberSchema.parse(request.body);

      // Verify both users are in the same org
      const orgId = await getUserOrganizationId(fastify.db, request.user.sub);
      const manager = await fastify.db('user').where({ id: manager_id }).first();
      const userToAdd = await fastify.db('user').where({ id: user_id }).first();

      if (!manager || !userToAdd) return reply.notFound('User not found');
      if (manager.organization_id !== orgId || userToAdd.organization_id !== orgId) {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Users must be in the same organization' });
      }
      if (manager.role !== 'manager') {
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
      const currentUser = await fastify.db('user').where({ id: request.user.sub }).first();
      if (currentUser?.role !== 'admin') {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Admin only' });
      }

      const { id } = uuidSchema.parse(request.params);
      const deleted = await service.removeMember(id);
      if (!deleted) return reply.notFound('Team member not found');
      return reply.code(204).send();
    });

    done();
  },
  { name: 'team-module' },
);
