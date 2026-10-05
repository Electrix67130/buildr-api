import fp from 'fastify-plugin';
import { z } from 'zod';

const blockSchema = z.object({ user_id: z.string().uuid() });
const userParam = z.object({ userId: z.string().uuid() });

/**
 * Blocage entre utilisateurs. Personnel et silencieux : seul celui qui bloque
 * en voit l'effet, la personne bloquee n'est pas prevenue.
 */
export default fp(
  (fastify, _opts, done) => {
    // GET /blocks — les personnes que j'ai bloquees
    fastify.get('/blocks', { preHandler: [fastify.authenticate] }, async (request) => {
      const rows = await fastify
        .db('user_block')
        .join('user', 'user.id', 'user_block.blocked_id')
        .where('user_block.blocker_id', request.user.sub)
        .select('user_block.blocked_id as user_id', 'user.first_name', 'user.last_name', 'user_block.created_at')
        .orderBy('user_block.created_at', 'desc');
      return { data: rows };
    });

    // POST /blocks — bloquer quelqu'un avec qui je partage une organisation
    fastify.post('/blocks', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { user_id } = blockSchema.parse(request.body);
      if (user_id === request.user.sub) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'On ne se bloque pas soi-même' });
      }
      // Une organisation en commun, sinon 404 : on ne confirme pas l'existence
      // d'un compte qu'on n'a aucune raison de connaitre.
      const shared = await fastify
        .db('organization_member as mine')
        .join('organization_member as theirs', 'theirs.organization_id', 'mine.organization_id')
        .where('mine.user_id', request.user.sub)
        .where('theirs.user_id', user_id)
        .first();
      if (!shared) return reply.notFound('Utilisateur introuvable');

      await fastify
        .db('user_block')
        .insert({ blocker_id: request.user.sub, blocked_id: user_id })
        .onConflict(['blocker_id', 'blocked_id'])
        .ignore();
      return reply.code(201).send({ user_id });
    });

    // DELETE /blocks/:userId — debloquer
    fastify.delete('/blocks/:userId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { userId } = userParam.parse(request.params);
      await fastify.db('user_block').where({ blocker_id: request.user.sub, blocked_id: userId }).del();
      return reply.code(204).send();
    });

    done();
  },
  { name: 'block-module' },
);
