import fp from 'fastify-plugin';
import NotificationPreferenceService from './notification-preference.service';
import { updateCategorySchema, chantierLevelSchema, chantierParamsSchema } from './notification-preference.schema';
import { isChantierParticipant } from '@/lib/permissions';

export default fp(
  (fastify, _opts, done) => {
    const service = new NotificationPreferenceService(fastify.db);

    // GET /notification-preferences — interrupteur general, categories, chantiers en sourdine
    fastify.get('/notification-preferences', { preHandler: [fastify.authenticate] }, async (request) => {
      return service.get(request.user.sub);
    });

    // PATCH /notification-preferences — une categorie a la fois
    fastify.patch('/notification-preferences', { preHandler: [fastify.authenticate] }, async (request) => {
      const data = updateCategorySchema.parse(request.body);
      await service.updateCategory(request.user.sub, data);
      return data;
    });

    // GET /notification-preferences/chantiers/:chantierId — reglage d'un chantier
    fastify.get(
      '/notification-preferences/chantiers/:chantierId',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { chantierId } = chantierParamsSchema.parse(request.params);
        if (!(await isChantierParticipant(fastify.db, request.user.sub, chantierId))) {
          return reply.notFound('Chantier not found');
        }
        return { chantier_id: chantierId, level: await service.getChantierLevel(request.user.sub, chantierId) };
      },
    );

    // PUT /notification-preferences/chantiers/:chantierId — tout, l'important, ou rien
    fastify.put(
      '/notification-preferences/chantiers/:chantierId',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { chantierId } = chantierParamsSchema.parse(request.params);
        const { level } = chantierLevelSchema.parse(request.body);
        if (!(await isChantierParticipant(fastify.db, request.user.sub, chantierId))) {
          return reply.notFound('Chantier not found');
        }
        await service.setChantierLevel(request.user.sub, chantierId, level);
        return { chantier_id: chantierId, level };
      },
    );

    done();
  },
  { name: 'notification-preference-module' },
);
