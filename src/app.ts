import fastify, { FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import autoload from '@fastify/autoload';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'path';
import env from './config/env';
import database from './plugins/database';
import errorHandler from './plugins/error-handler';
import apiKey from './plugins/api-key';
import jwtPlugin from './plugins/jwt';
import uploadPlugin from './plugins/upload';
import signUrlsPlugin from './plugins/sign-urls';
import { UPLOAD_DIR } from './lib/storage';
import websocketPlugin from './plugins/websocket';

interface AppOptions extends FastifyServerOptions {
  logLevel?: string;
}

function buildApp(opts: AppOptions = {}) {
  const { logLevel, ...fastifyOpts } = opts;
  const app = fastify({
    logger: {
      level: logLevel || 'info',
    },
    ...fastifyOpts,
  });

  // Security plugins
  app.register(helmet);
  // En prod : liste blanche (dashboard + vitrine). Les apps natives n'envoient
  // pas d'en-tete Origin, elles ne sont donc pas concernees par le CORS.
  // En dev : on autorise toutes les origines.
  const corsOrigin =
    env.NODE_ENV === 'production'
      ? env.CORS_ORIGINS
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean)
      : true;
  app.register(cors, { origin: corsOrigin, methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'] });
  app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  app.register(sensible);

  // File handling
  app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB max
  // serve: false — on ne veut que reply.sendFile(), pas de route publique. Le
  // prefixe /uploads/ exposait tous les fichiers derriere la seule cle d'API,
  // laquelle est embarquee en clair dans le bundle mobile : cela court-circuitait
  // les URLs signees de /files. Personne ne l'utilisait.
  app.register(fastifyStatic, { root: UPLOAD_DIR, serve: false, decorateReply: true });

  // Infrastructure plugins
  app.register(database);
  app.register(errorHandler);
  app.register(apiKey);
  app.register(jwtPlugin);
  app.register(uploadPlugin);
  app.register(signUrlsPlugin);
  app.register(websocketPlugin);

  // Auto-load all modules (each module registers its own routes)
  app.register(autoload, {
    dir: path.join(__dirname, 'modules'),
    encapsulate: false,
    maxDepth: 1,
  });

  // Health check
  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}

export default buildApp;
