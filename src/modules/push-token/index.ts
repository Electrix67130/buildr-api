import fp from 'fastify-plugin';
import { z } from 'zod';
import { registerPushTokenSchema, unregisterPushTokenSchema } from './push-token.schema';

const togglePushSchema = z.object({
  enabled: z.boolean(),
});

export default fp(
  (fastify, _opts, done) => {
    // POST /push-tokens — enregistre un token Expo pour le device courant
    fastify.post('/push-tokens', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const data = registerPushTokenSchema.parse(request.body);
      // Si le token existe deja (autre user), on le reaffecte au user courant.
      // Cela evite qu'un device qui change de compte continue a recevoir les pushs de l'ancien.
      await fastify.db('push_token')
        .insert({
          user_id: request.user.sub,
          token: data.token,
          platform: data.platform ?? null,
          updated_at: fastify.db.fn.now(),
        })
        .onConflict('token')
        .merge({
          user_id: request.user.sub,
          platform: data.platform ?? null,
          updated_at: fastify.db.fn.now(),
        });
      return reply.code(204).send();
    });

    // DELETE /push-tokens — supprime un token (logout, desactivation des notifs)
    fastify.delete('/push-tokens', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const data = unregisterPushTokenSchema.parse(request.body);
      await fastify.db('push_token')
        .where({ token: data.token, user_id: request.user.sub })
        .del();
      return reply.code(204).send();
    });

    // PATCH /push-tokens/preference — toggle global ON/OFF des push pour le user
    fastify.patch('/push-tokens/preference', { preHandler: [fastify.authenticate] }, async (request) => {
      const { enabled } = togglePushSchema.parse(request.body);
      await fastify.db('user')
        .where({ id: request.user.sub })
        .update({ push_enabled: enabled, updated_at: fastify.db.fn.now() });
      return { push_enabled: enabled };
    });

    done();
  },
  { name: 'push-token-module' },
);
