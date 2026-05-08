import fp from 'fastify-plugin';
import { z } from 'zod';
import CommentService from './comment.service';
import { createCommentSchema, updateCommentSchema } from './comment.schema';
import { requirePermission } from '@/lib/permissions';
import { emitToChantier } from '@/lib/realtime-hub';
import { sendPushToChantier } from '@/lib/push-notifications';
import { getActorAndChantierNames, truncate } from '@/lib/push-helpers';

const byChantierSchema = z.object({
  chantier_id: z.string().uuid(),
  // step_id filter : 'general' = uniquement les messages hors-etape (step_id IS NULL),
  // un uuid = uniquement les messages de cette etape, omis = tous les messages.
  step_id: z.union([z.string().uuid(), z.literal('general')]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
});

const uuidSchema = z.object({ id: z.string().uuid() });

export default fp(
  (fastify, _opts, done) => {
    const service = new CommentService(fastify.db);

    // GET /comments?chantier_id=xxx[&step_id=...] — requires view_comments
    fastify.get('/comments', { preHandler: [fastify.authenticate] }, async (request) => {
      const { chantier_id, step_id, ...pagination } = byChantierSchema.parse(request.query);
      await requirePermission(fastify.db, request.user.sub, chantier_id, 'view_comments');
      return service.findByChantier(chantier_id, { ...pagination, stepId: step_id });
    });

    // GET /comments/:id
    fastify.get('/comments/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const comment = await service.findById(id);
      if (!comment) return reply.notFound('Comment not found');
      await requirePermission(fastify.db, request.user.sub, comment.chantier_id, 'view_comments');
      return comment;
    });

    // POST /comments — requires view_comments (anyone who can see can post)
    fastify.post('/comments', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const data = createCommentSchema.parse(request.body);
      await requirePermission(fastify.db, request.user.sub, data.chantier_id, 'view_comments');

      // Si step_id fourni, verifier qu'il appartient bien au meme chantier
      if (data.step_id) {
        const step = await fastify.db('chantier_step').where({ id: data.step_id }).select('chantier_id').first();
        if (!step || step.chantier_id !== data.chantier_id) {
          return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'step_id ne correspond pas au chantier' });
        }
      }

      const comment = await service.create({ ...data, author_id: request.user.sub });
      emitToChantier(fastify.db, data.chantier_id, {
        type: 'comment.created',
        chantier_id: data.chantier_id,
        resource_id: comment.id,
        actor_id: request.user.sub,
      }).catch((err) => fastify.log.error({ err }, 'WS emit failed'));
      // Push notification (fire-and-forget, ne bloque pas la reponse).
      (async () => {
        const { actorName, chantierName } = await getActorAndChantierNames(fastify.db, request.user.sub, data.chantier_id);
        await sendPushToChantier(
          fastify.db,
          data.chantier_id,
          request.user.sub,
          {
            title: `💬 ${chantierName}`,
            body: `${actorName} : ${truncate(data.content, 100)}`,
            data: { type: 'comment', chantier_id: data.chantier_id },
          },
          fastify.log,
        );
      })().catch((err) => fastify.log.error({ err }, 'Push send failed'));
      return reply.code(201).send(comment);
    });

    // PATCH /comments/:id — only the author can edit
    fastify.patch('/comments/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const data = updateCommentSchema.parse(request.body);
      const existing = await service.findById(id);
      if (!existing) return reply.notFound('Comment not found');
      if (existing.author_id !== request.user.sub) {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Only the author can edit this comment' });
      }
      const comment = await service.update(id, data);
      emitToChantier(fastify.db, existing.chantier_id, {
        type: 'comment.updated',
        chantier_id: existing.chantier_id,
        resource_id: id,
        actor_id: request.user.sub,
      }).catch((err) => fastify.log.error({ err }, 'WS emit failed'));
      return comment;
    });

    // DELETE /comments/:id — author or users with edit permission
    fastify.delete('/comments/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const existing = await service.findById(id);
      if (!existing) return reply.notFound('Comment not found');
      if (existing.author_id !== request.user.sub) {
        await requirePermission(fastify.db, request.user.sub, existing.chantier_id, 'edit');
      }
      await service.delete(id);
      emitToChantier(fastify.db, existing.chantier_id, {
        type: 'comment.deleted',
        chantier_id: existing.chantier_id,
        resource_id: id,
        actor_id: request.user.sub,
      }).catch((err) => fastify.log.error({ err }, 'WS emit failed'));
      return reply.code(204).send();
    });

    done();
  },
  { name: 'comment-module' },
);
