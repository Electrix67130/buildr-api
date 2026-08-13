import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import env from '@/config/env';
import { getCachedSessionId, setCachedSessionId, type Platform } from '@/lib/session-cache';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string; jti?: string; impersonated_by?: string; platform?: Platform };
    user: { sub: string; email: string; jti?: string; impersonated_by?: string; platform?: Platform };
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

    // Une session active PAR PLATEFORME : le jti du token doit correspondre a la
    // session enregistree pour la sienne. Se connecter sur le mobile ne chasse
    // donc que la precedente session mobile — le dashboard reste ouvert, ce qui
    // correspond a l'usage reel (l'app sur le chantier, le dashboard au bureau).
    // La session est cachee en memoire (TTL 30s) pour eviter une lecture BDD a
    // chaque requete.
    //
    // Les tokens d'impersonation sont emis par un super admin, durent 30 min et ne
    // sont rattaches a aucune session de l'utilisateur cible : on les exempte du
    // controle (sinon ils seraient rejetes faute de jti).
    if (request.user?.impersonated_by) return;

    const tokenJti = request.user?.jti;
    const platform = request.user?.platform;

    // Tokens emis avant l'introduction du claim `platform` : acceptes sans
    // controle, ils disparaitront d'eux-memes a la prochaine connexion.
    if (!tokenJti || !platform) return;

    const cached = getCachedSessionId(request.user.sub, platform);
    let dbSessionId: string | null;
    if (cached === undefined) {
      const column = platform === 'mobile' ? 'current_mobile_session_id' : 'current_web_session_id';
      const row = await fastify.db('user').where({ id: request.user.sub }).select(column).first();
      dbSessionId = (row?.[column] as string | null) ?? null;
      setCachedSessionId(request.user.sub, platform, dbSessionId);
    } else {
      dbSessionId = cached;
    }

    if (dbSessionId !== tokenJti) {
      return reply.code(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Session expired (logged in elsewhere on this device type)',
      });
    }
  });
}

export default fp(jwtPlugin, { name: 'jwt' });
