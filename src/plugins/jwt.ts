import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import env from '@/config/env';
import { getCachedSessionId, setCachedSessionId } from '@/lib/session-cache';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string; jti?: string; impersonated_by?: string };
    user: { sub: string; email: string; jti?: string; impersonated_by?: string };
  }
}

async function jwtPlugin(fastify: FastifyInstance) {
  fastify.register(jwt, {
    secret: env.JWT_SECRET,
  });

  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Invalid or missing token',
      });
    }

    // Single-session enforcement : le jti du token doit correspondre au current_session_id
    // de l'utilisateur. Une nouvelle connexion ailleurs change le current_session_id et
    // invalide donc tous les anciens tokens. On cache le current_session_id en memoire (TTL 30s)
    // pour eviter une lecture BDD a chaque requete.
    // Les tokens d'impersonation sont emis par un super admin, durent 30 min et ne
    // sont rattaches a aucune session de l'utilisateur cible : on les exempte du
    // controle single-session (sinon ils seraient rejetes faute de jti).
    if (request.user?.impersonated_by) return;

    const tokenJti = request.user?.jti;
    if (!tokenJti) {
      return reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Token without session id' });
    }

    const cached = getCachedSessionId(request.user.sub);
    let dbSessionId: string | null;
    if (cached === undefined) {
      const row = await fastify.db('user').where({ id: request.user.sub }).select('current_session_id').first();
      dbSessionId = row?.current_session_id ?? null;
      setCachedSessionId(request.user.sub, dbSessionId);
    } else {
      dbSessionId = cached;
    }

    if (dbSessionId !== tokenJti) {
      return reply.code(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Session expired (logged in elsewhere)',
      });
    }
  });
}

export default fp(jwtPlugin, { name: 'jwt' });
