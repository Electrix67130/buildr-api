import fp from 'fastify-plugin';
import { z } from 'zod';
import PhotoCommentService from './photo-comment.service';
import { createPhotoCommentSchema } from './photo-comment.schema';

const byPhotoSchema = z.object({
  photo_id: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const uuidSchema = z.object({ id: z.string().uuid() });

export default fp(
  (fastify, _opts, done) => {
    const service = new PhotoCommentService(fastify.db);

    // GET /photo-comments?photo_id=xxx
    fastify.get('/photo-comments', { preHandler: [fastify.authenticate] }, async (request) => {
      const { photo_id, ...pagination } = byPhotoSchema.parse(request.query);
      return service.findByPhoto(photo_id, pagination);
    });

    // POST /photo-comments
    fastify.post('/photo-comments', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const data = createPhotoCommentSchema.parse(request.body);
      const comment = await service.create({ ...data, author_id: request.user.sub });
      return reply.code(201).send(comment);
    });

    // DELETE /photo-comments/:id
    fastify.delete('/photo-comments/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const deleted = await service.delete(id);
      if (!deleted) return reply.notFound('Photo comment not found');
      return reply.code(204).send();
    });

    done();
  },
  { name: 'photo-comment-module' },
);
