import fp from 'fastify-plugin';
import { createErrorReportSchema } from './error-report.schema';

/**
 * Collecte des erreurs clientes dans `error_log`, la meme table que les 500 de
 * l'API. Elles remontent donc dans la page `/admin/errors` du dashboard, sans
 * dependre d'un prestataire externe.
 *
 * Volontairement **sans authentification JWT** : un plantage survient aussi sur
 * l'ecran de connexion, et c'est justement celui-la qu'on ne veut pas rater. Si
 * un token valide accompagne la requete, l'utilisateur est rattache au
 * signalement.
 */
export default fp(
  (fastify, _opts, done) => {
    fastify.post(
      '/error-reports',
      {
        config: {
          // Plus strict que la limite globale : une boucle de plantage cote
          // client pourrait sinon inonder la table.
          rateLimit: { max: 20, timeWindow: '1 minute' },
        },
      },
      async (request, reply) => {
        const data = createErrorReportSchema.parse(request.body);

        // Rattachement facultatif a un utilisateur : on tente de lire le token
        // sans jamais faire echouer le signalement s'il est absent ou expire.
        let userId: string | null = null;
        try {
          const decoded = await request.jwtVerify<{ sub?: string }>();
          userId = decoded?.sub ?? null;
        } catch {
          // anonyme
        }

        await fastify.db('error_log').insert({
          level: data.level,
          message: data.message,
          stack: data.stack ?? null,
          source: data.source,
          platform: data.platform ?? null,
          app_version: data.app_version ?? null,
          screen: data.screen ?? null,
          user_id: userId,
        });

        // 202 : le signalement est accepte, le client n'a rien a en attendre.
        return reply.code(202).send();
      },
    );

    done();
  },
  { name: 'error-report-module' },
);
