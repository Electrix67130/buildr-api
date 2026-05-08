import fp from 'fastify-plugin';
import { z } from 'zod';
import ChantierService from './chantier.service';
import ChantierMemberService from '@/modules/chantier-member/chantier-member.service';
import { createChantierSchema, updateChantierSchema, searchChantierSchema, setRetentionSchema } from './chantier.schema';
import { getUserOrganizationId } from '@/lib/org-scope';
import { getActiveMembership } from '@/lib/active-membership';
import {
  fireAndForget,
  syncChantierDeleted,
  syncChantierUpdated,
  syncMemberAdded,
} from '@/modules/calendar-integration/sync';

const SYNC_TRIGGER_FIELDS = ['start_date', 'end_date', 'name', 'description', 'address', 'city', 'postal_code'] as const;

const paginationWithStatusSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  orderBy: z.string().optional().default('created_at'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
  status: z.enum(['a_venir', 'en_cours', 'termine']).optional(),
});

const archiveSearchSchema = z.object({
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  orderBy: z.string().optional().default('archived_at'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
});

const uuidSchema = z.object({ id: z.string().uuid() });

export default fp(
  (fastify, _opts, done) => {
    const service = new ChantierService(fastify.db);
    const memberService = new ChantierMemberService(fastify.db);

    // Helper: ensure the chantier belongs to the user's organization
    const assertSameOrg = async (chantierId: string, userId: string) => {
      const orgId = await getUserOrganizationId(fastify.db, userId);
      const chantier = await service.findById(chantierId);
      if (!chantier) return { found: false as const };
      if (chantier.organization_id !== orgId) {
        throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
      }
      return { found: true as const, chantier };
    };

    // Helper: check if current user is admin of their active org (admins see all chantiers, non-admins only their own)
    const getUserScope = async (userId: string) => {
      const m = await getActiveMembership(fastify.db, userId);
      if (!m) throw Object.assign(new Error('User has no active organization'), { statusCode: 403 });
      const isAdmin = m.role === 'admin';
      return { orgId: m.organization_id, userId, restrictToMember: !isAdmin };
    };

    // GET /chantiers — list active chantiers (non-archived), filterable by status
    fastify.get('/chantiers', { preHandler: [fastify.authenticate] }, async (request) => {
      const query = paginationWithStatusSchema.parse(request.query);
      const scope = await getUserScope(request.user.sub);
      return service.findActive(scope.orgId, { ...query, userId: scope.userId, restrictToMember: scope.restrictToMember });
    });

    // GET /chantiers/search — search by keyword and/or GPS
    fastify.get('/chantiers/search', { preHandler: [fastify.authenticate] }, async (request) => {
      const params = searchChantierSchema.parse(request.query);
      const scope = await getUserScope(request.user.sub);
      return service.search(scope.orgId, { ...params, userId: scope.userId, restrictToMember: scope.restrictToMember });
    });

    // GET /chantiers/archives — list archived chantiers
    fastify.get('/chantiers/archives', { preHandler: [fastify.authenticate] }, async (request) => {
      const query = archiveSearchSchema.parse(request.query);
      const scope = await getUserScope(request.user.sub);
      return service.findArchived(scope.orgId, { ...query, userId: scope.userId, restrictToMember: scope.restrictToMember });
    });

    // GET /chantiers/:id — get one (must be admin OR member OR creator)
    fastify.get('/chantiers/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const result = await assertSameOrg(id, request.user.sub);
      if (!result.found) return reply.notFound('Chantier not found');

      const scope = await getUserScope(request.user.sub);
      if (scope.restrictToMember) {
        // Check if user is creator or member
        if (result.chantier.created_by !== request.user.sub) {
          const member = await fastify.db('chantier_member')
            .where({ chantier_id: id, user_id: request.user.sub })
            .first();
          if (!member) return reply.notFound('Chantier not found');
        }
      }
      return result.chantier;
    });

    // POST /chantiers — create (admin only), optionally assign a manager
    fastify.post('/chantiers', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { manager_id, ...data } = createChantierSchema.parse(request.body);
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (membership?.role !== 'admin') {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Seul un administrateur peut créer un chantier' });
      }
      const orgId = membership.organization_id;
      const chantier = await service.create({ ...data, created_by: request.user.sub, organization_id: orgId });

      // Auto-assign manager as chantier member — verifier qu'il est membre de la meme org
      if (manager_id) {
        const managerMembership = await fastify.db('organization_member')
          .where({ user_id: manager_id, organization_id: orgId })
          .first();
        if (managerMembership) {
          await memberService.create({ chantier_id: chantier.id, user_id: manager_id, role: 'manager' });
          fireAndForget(() => syncMemberAdded(fastify.db, chantier.id, manager_id, fastify.log), fastify.log);
        }
      }

      // Sync the creator's connected calendars (creator is implicit member via created_by)
      fireAndForget(() => syncMemberAdded(fastify.db, chantier.id, request.user.sub, fastify.log), fastify.log);

      return reply.code(201).send(chantier);
    });

    // PATCH /chantiers/:id — update
    fastify.patch('/chantiers/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const data = updateChantierSchema.parse(request.body);
      const result = await assertSameOrg(id, request.user.sub);
      if (!result.found) return reply.notFound('Chantier not found');
      const chantier = await service.update(id, data);
      if (SYNC_TRIGGER_FIELDS.some((f) => f in data)) {
        fireAndForget(() => syncChantierUpdated(fastify.db, id, fastify.log), fastify.log);
      }
      return chantier;
    });

    // DELETE /chantiers/:id — delete
    fastify.delete('/chantiers/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const result = await assertSameOrg(id, request.user.sub);
      if (!result.found) return reply.notFound('Chantier not found');
      // Sync external calendars BEFORE deleting (we still need link rows to find external_event_id)
      await syncChantierDeleted(fastify.db, id, fastify.log);
      await service.delete(id);
      return reply.code(204).send();
    });

    // POST /chantiers/:id/archive — archive a chantier
    fastify.post('/chantiers/:id/archive', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const result = await assertSameOrg(id, request.user.sub);
      if (!result.found) return reply.notFound('Chantier not found');
      const chantier = await service.archive(id);
      if (!chantier) return reply.notFound('Chantier already archived');
      fireAndForget(() => syncChantierDeleted(fastify.db, id, fastify.log), fastify.log);
      return chantier;
    });

    // PATCH /chantiers/:id/retention — change retention duration for an archived chantier (admin only)
    fastify.patch('/chantiers/:id/retention', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const { years } = setRetentionSchema.parse(request.body);
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (membership?.role !== 'admin') {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Seul un administrateur peut modifier la durée de conservation' });
      }
      const result = await assertSameOrg(id, request.user.sub);
      if (!result.found) return reply.notFound('Chantier not found');
      const chantier = await service.setRetention(id, years);
      if (!chantier) return reply.notFound('Chantier not archived');
      return chantier;
    });

    // POST /chantiers/:id/unarchive — unarchive a chantier
    fastify.post('/chantiers/:id/unarchive', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const result = await assertSameOrg(id, request.user.sub);
      if (!result.found) return reply.notFound('Chantier not found');
      const chantier = await service.unarchive(id);
      if (!chantier) return reply.notFound('Chantier not archived');
      fireAndForget(() => syncChantierUpdated(fastify.db, id, fastify.log), fastify.log);
      return chantier;
    });

    done();
  },
  { name: 'chantier-module' },
);
