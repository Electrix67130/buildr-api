import fp from 'fastify-plugin';
import { z } from 'zod';
import EmergencyCommentService from './emergency-comment.service';
import { createEmergencyCommentSchema, updateEmergencyCommentSchema } from './emergency-comment.schema';
import { isChantierParticipant, isChantierAdminOrCreator } from '@/lib/permissions';
import { emitToChantier } from '@/lib/realtime-hub';
import { notifyMessage } from '@/lib/message-notifications';

const byEmergencySchema = z.object({
  emergency_id: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const uuidSchema = z.object({ id: z.string().uuid() });

export default fp(
  (fastify, _opts, done) => {
    const service = new EmergencyCommentService(fastify.db);

    /**
     * Chantier auquel appartient une urgence, si l'appelant y participe.
     *
     * Ces routes ne verifiaient que l'authentification : n'importe quel compte,
     * de n'importe quelle organisation, pouvait lire et ecrire dans le fil
     * d'une urgence dont il connaissait l'identifiant. Or une urgence decrit un
     * incident sur un chantier — parfois un accident, parfois une mise en cause.
     *
     * On repond 404 plutot que 403 : dire « interdit » confirmerait que
     * l'urgence existe.
     */
    const chantierAccessible = async (userId: string, emergencyId: string): Promise<string | null> => {
      const emergency = await fastify.db('chantier_emergency')
        .where({ id: emergencyId })
        .select('chantier_id')
        .first();
      if (!emergency) return null;
      return (await isChantierParticipant(fastify.db, userId, emergency.chantier_id))
        ? emergency.chantier_id
        : null;
    };

    // GET /emergency-comments?emergency_id=xxx
    fastify.get('/emergency-comments', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { emergency_id, ...pagination } = byEmergencySchema.parse(request.query);
      if (!(await chantierAccessible(request.user.sub, emergency_id))) {
        return reply.notFound('Emergency not found');
      }
      return service.findByEmergency(emergency_id, pagination, request.user.sub);
    });

    // POST /emergency-comments
    fastify.post('/emergency-comments', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const data = createEmergencyCommentSchema.parse(request.body);
      if (!(await chantierAccessible(request.user.sub, data.emergency_id))) {
        return reply.notFound('Emergency not found');
      }
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
        notifyMessage(fastify.db, fastify.log, {
          chantierId: emergency.chantier_id,
          authorId: request.user.sub,
          commentId: comment.id,
          content: data.content,
          emergencyId: data.emergency_id,
        }).catch((err) => fastify.log.error({ err }, 'Push send failed'));
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
        // Seules les personnes nouvellement mentionnees sont prevenues.
        notifyMessage(fastify.db, fastify.log, {
          chantierId: emergency.chantier_id,
          authorId: request.user.sub,
          commentId: id,
          content: data.content,
          previousContent: existing.content,
          emergencyId: existing.emergency_id,
        }).catch((err) => fastify.log.error({ err }, 'Push send failed'));
      }
      return updated;
    });

    // DELETE /emergency-comments/:id — auteur ou admin
    fastify.delete('/emergency-comments/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const existing = await service.findById(id);
      if (!existing) return reply.notFound('Emergency comment not found');
      // L'auteur, ou l'administrateur de l'organisation DU CHANTIER — pas
      // n'importe quel administrateur.
      const chantierId = await chantierAccessible(request.user.sub, existing.emergency_id);
      const estAdmin = chantierId
        ? await isChantierAdminOrCreator(fastify.db, request.user.sub, chantierId)
        : false;
      if (existing.author_id !== request.user.sub && !estAdmin) {
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
