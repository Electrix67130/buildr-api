import fp from 'fastify-plugin';
import { z } from 'zod';
import EmergencyCommentService from './emergency-comment.service';
import { createEmergencyCommentSchema, updateEmergencyCommentSchema } from './emergency-comment.schema';
import { getActiveMembership } from '@/lib/active-membership';
import { emitToChantier } from '@/lib/realtime-hub';
import { sendPushToChantier } from '@/lib/push-notifications';
import { getActorAndChantierNames, truncate } from '@/lib/push-helpers';

const byEmergencySchema = z.object({
  emergency_id: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const uuidSchema = z.object({ id: z.string().uuid() });

export default fp(
  (fastify, _opts, done) => {
    const service = new EmergencyCommentService(fastify.db);

    // GET /emergency-comments?emergency_id=xxx
    fastify.get('/emergency-comments', { preHandler: [fastify.authenticate] }, async (request) => {
      const { emergency_id, ...pagination } = byEmergencySchema.parse(request.query);
      return service.findByEmergency(emergency_id, pagination);
    });

    // POST /emergency-comments
    fastify.post('/emergency-comments', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const data = createEmergencyCommentSchema.parse(request.body);
      const comment = await service.create({ ...data, author_id: request.user.sub });
      // Resoudre le chantier_id via l'urgence parent pour l'event WS.
      const emergency = await fastify.db('chantier_emergency').where({ id: data.emergency_id }).select('chantier_id').first();
      if (emergency) {
        emitToChantier(fastify.db, emergency.chantier_id, {
          type: 'emergency-comment.created',
          chantier_id: emergency.chantier_id,
          resource_id: comment.id,
          actor_id: request.user.sub,
        }).catch((err) => fastify.log.error({ err }, 'WS emit failed'));
        (async () => {
          const { actorName, chantierName } = await getActorAndChantierNames(fastify.db, request.user.sub, emergency.chantier_id);
          await sendPushToChantier(
            fastify.db,
            emergency.chantier_id,
            request.user.sub,
            {
              title: `🚨 ${chantierName}`,
              body: `${actorName} : ${truncate(data.content, 100)}`,
              data: { type: 'emergency-comment', chantier_id: emergency.chantier_id, emergency_id: data.emergency_id },
            },
            fastify.log,
          );
        })().catch((err) => fastify.log.error({ err }, 'Push send failed'));
      }
      return reply.code(201).send(comment);
    });

    // PATCH /emergency-comments/:id — auteur uniquement
    fastify.patch('/emergency-comments/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const data = updateEmergencyCommentSchema.parse(request.body);
      const existing = await service.findById(id);
      if (!existing) return reply.notFound('Emergency comment not found');
      if (existing.author_id !== request.user.sub) {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Seul l\'auteur peut modifier son commentaire' });
      }
      const updated = await service.update(id, { content: data.content });
      const emergency = await fastify.db('chantier_emergency').where({ id: existing.emergency_id }).select('chantier_id').first();
      if (emergency) {
        emitToChantier(fastify.db, emergency.chantier_id, {
          type: 'emergency-comment.updated',
          chantier_id: emergency.chantier_id,
          resource_id: id,
          actor_id: request.user.sub,
        }).catch((err) => fastify.log.error({ err }, 'WS emit failed'));
      }
      return updated;
    });

    // DELETE /emergency-comments/:id — auteur ou admin
    fastify.delete('/emergency-comments/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const existing = await service.findById(id);
      if (!existing) return reply.notFound('Emergency comment not found');
      const me = await getActiveMembership(fastify.db, request.user.sub);
      if (existing.author_id !== request.user.sub && me?.role !== 'admin') {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Permission refusée' });
      }
      await service.delete(id);
      const emergency = await fastify.db('chantier_emergency').where({ id: existing.emergency_id }).select('chantier_id').first();
      if (emergency) {
        emitToChantier(fastify.db, emergency.chantier_id, {
          type: 'emergency-comment.deleted',
          chantier_id: emergency.chantier_id,
          resource_id: id,
          actor_id: request.user.sub,
        }).catch((err) => fastify.log.error({ err }, 'WS emit failed'));
      }
      return reply.code(204).send();
    });

    done();
  },
  { name: 'emergency-comment-module' },
);
