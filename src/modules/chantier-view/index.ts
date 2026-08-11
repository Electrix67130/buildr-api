import fp from 'fastify-plugin';
import { z } from 'zod';
import ChantierViewService from './chantier-view.service';
import { markViewedSchema, markItemViewedSchema } from './chantier-view.schema';

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

    // POST /chantier-views/item — mark a specific step / emergency as viewed
    // (clears its per-item dot without touching the tab-level last_viewed_at)
    fastify.post('/chantier-views/item', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { item_type, item_id } = markItemViewedSchema.parse(request.body);
      await service.markItemViewed(request.user.sub, item_type, item_id);
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
