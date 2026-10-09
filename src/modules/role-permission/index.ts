import fp from 'fastify-plugin';
import RolePermissionService from './role-permission.service';
import { roleParamsSchema, updateRolePermissionsSchema } from './role-permission.schema';
import { getActiveMembership } from '@/lib/active-membership';
import { emitToChantier } from '@/lib/realtime-hub';

export default fp(
  (fastify, _opts, done) => {
    const service = new RolePermissionService(fastify.db);

    /** L'organisation active, si l'appelant en est administrateur. */
    const adminOrganization = async (userId: string): Promise<string | null> => {
      const membership = await getActiveMembership(fastify.db, userId);
      return membership?.role === 'admin' ? membership.organization_id : null;
    };

    /** Les droits des membres ont change sur ces chantiers : les clients relisent l'equipe. */
    const notify = (chantierIds: string[], actorId: string) => {
      for (const chantierId of chantierIds) {
        emitToChantier(fastify.db, chantierId, {
          type: 'chantier-member.updated',
          chantier_id: chantierId,
          resource_id: chantierId,
          actor_id: actorId,
        }).catch((err) => fastify.log.error({ err }, 'WS emit failed'));
      }
    };

    // GET /role-permissions — droits de depart de chaque role dans l'organisation active
    fastify.get('/role-permissions', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const organizationId = await adminOrganization(request.user.sub);
      if (!organizationId) return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Reserve aux administrateurs' });
      return service.list(organizationId);
    });

    // PUT /role-permissions/:role — regle un role et l'applique a tous ses membres
    fastify.put('/role-permissions/:role', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { role } = roleParamsSchema.parse(request.params);
      const permissions = updateRolePermissionsSchema.parse(request.body);
      const organizationId = await adminOrganization(request.user.sub);
      if (!organizationId) return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Reserve aux administrateurs' });
      const { chantierIds, updated } = await service.set(organizationId, role, permissions);
      notify(chantierIds, request.user.sub);
      return { role, ...permissions, customized: true, updated_members: updated };
    });

    // DELETE /role-permissions/:role — retour aux valeurs d'origine, applique a tous ses membres
    fastify.delete('/role-permissions/:role', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { role } = roleParamsSchema.parse(request.params);
      const organizationId = await adminOrganization(request.user.sub);
      if (!organizationId) return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Reserve aux administrateurs' });
      const { chantierIds, updated } = await service.reset(organizationId, role);
      notify(chantierIds, request.user.sub);
      return { role, updated_members: updated };
    });

    done();
  },
  { name: 'role-permission-module' },
);
