import fp from 'fastify-plugin';
import { z } from 'zod';
import ChantierViewService from './chantier-view.service';
import { markViewedSchema } from './chantier-view.schema';

const unreadQuerySchema = z.object({
  chantier_id: z.string().uuid(),
});

export default fp(
  (fastify, _opts, done) => {
    const service = new ChantierViewService(fastify.db);

    // POST /chantier-views — mark a tab as viewed
    fastify.post('/chantier-views', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { chantier_id, tab } = markViewedSchema.parse(request.body);
      await service.markViewed(request.user.sub, chantier_id, tab);
      return reply.code(204).send();
    });

    // GET /chantier-views/unread?chantier_id=xxx — counts par onglet
    fastify.get('/chantier-views/unread', { preHandler: [fastify.authenticate] }, async (request) => {
      const { chantier_id } = unreadQuerySchema.parse(request.query);
      return service.unreadCounts(request.user.sub, chantier_id);
    });

    // GET /chantier-views/unread-summary — totaux par chantier et par organisation
    fastify.get('/chantier-views/unread-summary', { preHandler: [fastify.authenticate] }, async (request) => {
      return service.unreadSummary(request.user.sub);
    });

    done();
  },
  { name: 'chantier-view-module' },
);
