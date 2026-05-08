import fp from 'fastify-plugin';
import { z } from 'zod';
import env from '@/config/env';
import CalendarIntegrationService from './calendar-integration.service';
import {
  calendarProviderSchema,
  CalendarIntegrationRow,
  IntegrationPublic,
} from './calendar-integration.schema';
import * as google from './providers/google';
import * as outlook from './providers/outlook';
import { buildIcsForUser } from './providers/apple';
import { fireAndForget, syncMemberAdded } from './sync';

const stateSchema = z.object({
  sub: z.string().uuid(),
  p: z.enum(['google', 'outlook']),
});

const providerParamSchema = z.object({ provider: calendarProviderSchema });
const callbackQuerySchema = z.object({ code: z.string().min(1), state: z.string().min(1), error: z.string().optional() });
const icalParamSchema = z.object({ token: z.string().min(8).max(128) });

function publicView(integration: CalendarIntegrationRow, baseUrl: string): IntegrationPublic {
  const view: IntegrationPublic = {
    provider: integration.provider,
    connected: true,
    last_sync_at: integration.last_sync_at,
  };
  if (integration.provider === 'apple' && integration.ical_token) {
    view.ical_url = `${baseUrl}/calendar/ical/${integration.ical_token}.ics`;
  }
  return view;
}

function appCallbackRedirect(provider: string, status: 'ok' | 'error', message?: string): string {
  const params = new URLSearchParams({ provider, status });
  if (message) params.set('message', message);
  return `buildr://calendar-callback?${params.toString()}`;
}

export default fp(
  (fastify, _opts, done) => {
    const service = new CalendarIntegrationService(fastify.db);

    // GET /calendar/integrations — list current user's integrations
    fastify.get('/calendar/integrations', { preHandler: [fastify.authenticate] }, async (request) => {
      const integrations = await service.findByUser(request.user.sub);
      const baseUrl = env.CALENDAR_OAUTH_REDIRECT_BASE;
      return integrations.map((i) => publicView(i, baseUrl));
    });

    // POST /calendar/oauth/:provider/start — returns auth URL for Google or Outlook
    fastify.post('/calendar/oauth/:provider/start', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { provider } = z.object({ provider: z.enum(['google', 'outlook']) }).parse(request.params);

      if (provider === 'google' && !google.isConfigured()) {
        return reply.code(503).send({ statusCode: 503, error: 'Service Unavailable', message: 'Google OAuth non configuré (GOOGLE_CLIENT_ID/SECRET manquants)' });
      }
      if (provider === 'outlook' && !outlook.isConfigured()) {
        return reply.code(503).send({ statusCode: 503, error: 'Service Unavailable', message: 'Outlook OAuth non configuré (OUTLOOK_CLIENT_ID/SECRET manquants)' });
      }

      const state = await fastify.jwt.sign({ sub: request.user.sub, p: provider } as never, { expiresIn: '10m' });
      const auth_url = provider === 'google' ? google.buildGoogleAuthUrl(state) : outlook.buildOutlookAuthUrl(state);
      return { auth_url };
    });

    // GET /calendar/oauth/:provider/callback — OAuth redirect target (no API key, no auth)
    fastify.get('/calendar/oauth/:provider/callback', async (request, reply) => {
      const { provider } = z.object({ provider: z.enum(['google', 'outlook']) }).parse(request.params);
      const query = callbackQuerySchema.safeParse(request.query);

      if (!query.success || query.data.error) {
        return reply.redirect(appCallbackRedirect(provider, 'error', query.data?.error || 'invalid_request'));
      }

      let parsedState: { sub: string; p: 'google' | 'outlook' };
      try {
        const decoded = await fastify.jwt.verify<{ sub: string; p: 'google' | 'outlook' }>(query.data.state);
        parsedState = stateSchema.parse(decoded);
      } catch {
        return reply.redirect(appCallbackRedirect(provider, 'error', 'invalid_state'));
      }
      if (parsedState.p !== provider) {
        return reply.redirect(appCallbackRedirect(provider, 'error', 'state_mismatch'));
      }

      try {
        if (provider === 'google') {
          const tokens = await google.exchangeCodeForTokens(query.data.code);
          if (!tokens.refresh_token) throw new Error('no_refresh_token');
          await service.upsertOAuth(parsedState.sub, 'google', tokens.refresh_token, 'primary');
        } else {
          const tokens = await outlook.exchangeCodeForTokens(query.data.code);
          if (!tokens.refresh_token) throw new Error('no_refresh_token');
          await service.upsertOAuth(parsedState.sub, 'outlook', tokens.refresh_token, '');
        }
      } catch (err) {
        fastify.log.error({ err }, 'OAuth callback failed');
        return reply.redirect(appCallbackRedirect(provider, 'error', 'token_exchange_failed'));
      }

      // Initial back-fill: push every chantier the user is part of
      const chantiers = await fastify.db('chantier')
        .whereNull('archived_at')
        .where((qb) => {
          qb.where('created_by', parsedState.sub).orWhereExists(function () {
            this.select('*')
              .from('chantier_member')
              .whereRaw('chantier_member.chantier_id = chantier.id')
              .where('chantier_member.user_id', parsedState.sub);
          });
        })
        .select('id');
      for (const c of chantiers as { id: string }[]) {
        fireAndForget(() => syncMemberAdded(fastify.db, c.id, parsedState.sub, fastify.log), fastify.log);
      }

      return reply.redirect(appCallbackRedirect(provider, 'ok'));
    });

    // POST /calendar/apple/connect — generate (or fetch existing) iCal subscribe URL
    fastify.post('/calendar/apple/connect', { preHandler: [fastify.authenticate] }, async (request) => {
      const integration = await service.ensureAppleIntegration(request.user.sub);
      return publicView(integration, env.CALENDAR_OAUTH_REDIRECT_BASE);
    });

    // DELETE /calendar/integrations/:provider — disconnect a provider
    fastify.delete('/calendar/integrations/:provider', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { provider } = providerParamSchema.parse(request.params);
      const ok = await service.disconnect(request.user.sub, provider);
      if (!ok) return reply.notFound('Intégration non trouvée');
      return reply.code(204).send();
    });

    // GET /calendar/ical/:token.ics — public iCal feed (subscribe URL for Apple/any client)
    fastify.get('/calendar/ical/:token.ics', async (request, reply) => {
      const params = icalParamSchema.safeParse(request.params);
      if (!params.success) return reply.code(404).send();

      const integration = await service.findByIcalToken(params.data.token);
      if (!integration) return reply.code(404).send();

      const ics = await buildIcsForUser(fastify.db, integration.user_id);
      reply.header('Content-Type', 'text/calendar; charset=utf-8');
      reply.header('Cache-Control', 'private, max-age=300');
      return ics;
    });

    done();
  },
  { name: 'calendar-integration-module' },
);
