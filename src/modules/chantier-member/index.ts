import fp from 'fastify-plugin';
import { z } from 'zod';
import ChantierMemberService from './chantier-member.service';
import { createChantierMemberSchema, updateChantierMemberSchema } from './chantier-member.schema';
import { hasPermission } from '@/lib/permissions';
import { getActiveMembership } from '@/lib/active-membership';
import { fireAndForget, syncMemberAdded, syncMemberRemoved } from '@/modules/calendar-integration/sync';
import { sendPushToUser } from '@/lib/push-notifications';
import { getActorAndChantierNames } from '@/lib/push-helpers';
import { emitToChantier } from '@/lib/realtime-hub';

const byChantierSchema = z.object({
  chantier_id: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const uuidSchema = z.object({ id: z.string().uuid() });

/**
 * Check if current user can add/remove members on a chantier:
 * - Admin, chantier creator, manager (member of this chantier), or member with can_edit
 */
async function canAddRemoveMembers(db: import('knex').Knex, userId: string, chantierId: string): Promise<boolean> {
  const m = await getActiveMembership(db, userId);
  if (m?.role === 'admin') return true;

  const chantier = await db('chantier').where({ id: chantierId }).select('created_by').first();
  if (chantier?.created_by === userId) return true;

  const member = await db('chantier_member')
    .where({ chantier_id: chantierId, user_id: userId })
    .select('can_edit')
    .first();

  if (m?.role === 'manager' && member) return true;

  return !!member?.can_edit;
}

/**
 * Check if current user can edit roles/permissions of members:
 * - Admin or chantier creator only (NOT manager)
 */
async function canEditPermissions(db: import('knex').Knex, userId: string, chantierId: string): Promise<boolean> {
  const m = await getActiveMembership(db, userId);
  if (m?.role === 'admin') return true;

  const chantier = await db('chantier').where({ id: chantierId }).select('created_by').first();
  return chantier?.created_by === userId;
}

export default fp(
  (fastify, _opts, done) => {
    const service = new ChantierMemberService(fastify.db);

    // GET /chantier-members/by-chantier — view_team renvoie la liste complete ; sinon
    // un membre du chantier (sans view_team) recoit uniquement sa propre ligne, dont
    // l'UI a besoin pour connaitre son role/permissions sur ce chantier.
    fastify.get(
      '/chantier-members/by-chantier',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { chantier_id, ...pagination } = byChantierSchema.parse(request.query);
        const canViewAll = await hasPermission(fastify.db, request.user.sub, chantier_id, 'view_team');
        if (canViewAll) return service.findByChantier(chantier_id, pagination);

        const ownRow = await service.findOwnWithUser(request.user.sub, chantier_id);
        if (!ownRow) {
          return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Pas membre de ce chantier' });
        }
        return { data: [ownRow], meta: { total: 1, page: 1, limit: 1, totalPages: 1 } };
      },
    );

    // POST /chantier-members — admin / creator / manager / edit permission
    fastify.post('/chantier-members', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const data = createChantierMemberSchema.parse(request.body);
      const can = await canAddRemoveMembers(fastify.db, request.user.sub, data.chantier_id);
      if (!can) return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Insufficient permissions to manage members' });

      // Verify que l'utilisateur cible a une membership dans l'org du chantier.
      // (Multi-org : on regarde organization_member, plus le legacy user.organization_id.)
      const chantier = await fastify.db('chantier').where({ id: data.chantier_id }).first();
      const userToAdd = await fastify.db('user').where({ id: data.user_id }).first();
      if (!chantier || !userToAdd) return reply.notFound('Chantier or user not found');
      const targetMembership = await fastify.db('organization_member')
        .where({ user_id: data.user_id, organization_id: chantier.organization_id })
        .first();
      if (!targetMembership) {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Cet utilisateur n\'appartient pas à votre organisation' });
      }

      // Check if already a member
      const existing = await fastify.db('chantier_member').where({ chantier_id: data.chantier_id, user_id: data.user_id }).first();
      if (existing) {
        return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'Cet utilisateur est déjà membre du chantier' });
      }

      const member = await service.create(data);
      fireAndForget(() => syncMemberAdded(fastify.db, member.chantier_id, member.user_id, fastify.log), fastify.log);
      emitToChantier(fastify.db, member.chantier_id, {
        type: 'chantier-member.created',
        chantier_id: member.chantier_id,
        resource_id: member.id,
        actor_id: request.user.sub,
      }).catch((err) => fastify.log.error({ err }, 'WS emit failed'));
      // Push notification au nouveau membre.
      (async () => {
        const { actorName, chantierName } = await getActorAndChantierNames(fastify.db, request.user.sub, member.chantier_id);
        await sendPushToUser(
          fastify.db,
          member.user_id,
          {
            title: `👋 ${chantierName}`,
            body: `${actorName} t'a ajouté à ce chantier`,
            data: { type: 'chantier-member', chantier_id: member.chantier_id },
          },
          fastify.log,
        );
      })().catch((err) => fastify.log.error({ err }, 'Push send failed'));
      return reply.code(201).send(member);
    });

    // PATCH /chantier-members/:id — admin / creator only (not manager)
    fastify.patch('/chantier-members/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const data = updateChantierMemberSchema.parse(request.body);
      const existing = await service.findById(id);
      if (!existing) return reply.notFound('Member not found');

      const can = await canEditPermissions(fastify.db, request.user.sub, existing.chantier_id);
      if (!can) return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Only admins can edit member permissions' });

      // If role is changing, reset permissions to role defaults (unless explicitly overridden)
      const member = data.role && data.role !== existing.role
        ? await service.changeRole(id, data.role, data)
        : await service.update(id, data);
      emitToChantier(fastify.db, existing.chantier_id, {
        type: 'chantier-member.updated',
        chantier_id: existing.chantier_id,
        resource_id: id,
        actor_id: request.user.sub,
      }).catch((err) => fastify.log.error({ err }, 'WS emit failed'));
      return member;
    });

    // DELETE /chantier-members/:id — admin / creator / manager
    fastify.delete('/chantier-members/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const existing = await service.findById(id);
      if (!existing) return reply.notFound('Member not found');

      const can = await canAddRemoveMembers(fastify.db, request.user.sub, existing.chantier_id);
      if (!can) return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Insufficient permissions to manage members' });

      await service.delete(id);
      fireAndForget(() => syncMemberRemoved(fastify.db, existing.chantier_id, existing.user_id, fastify.log), fastify.log);
      emitToChantier(fastify.db, existing.chantier_id, {
        type: 'chantier-member.deleted',
        chantier_id: existing.chantier_id,
        resource_id: id,
        actor_id: request.user.sub,
      }).catch((err) => fastify.log.error({ err }, 'WS emit failed'));
      return reply.code(204).send();
    });

    done();
  },
  { name: 'chantier-member-module' },
);
