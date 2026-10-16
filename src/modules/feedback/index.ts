import fp from 'fastify-plugin';
import { z } from 'zod';
import FeedbackService from './feedback.service';
import { createFeedbackSchema, respondFeedbackSchema, listFeedbackSchema } from './feedback.schema';
import { getActiveMembership } from '@/lib/active-membership';
import { requireSuperAdmin, logAudit } from '@/lib/super-admin';
import { sendPushToUser, sendPushToUsers } from '@/lib/push-notifications';
import { buildFeedbackReplyPush, feedbackNewPush } from '@/lib/push-i18n';
import { buildFeedbackAlertEmail, sendMail } from '@/lib/mailer';
import env from '@/config/env';

const uuidParamSchema = z.object({ id: z.string().uuid() });
const minePaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * Signalements : bugs et suggestions envoyes par les utilisateurs.
 *
 * Deux publics dans un seul module. Tout utilisateur connecte peut deposer un
 * signalement et relire les siens ; seul un super admin voit ceux des autres et
 * y repond. Les routes de la console sont donc prefixees `/super-admin/` pour
 * rester coherentes avec le reste de cette console, mais elles vivent ici :
 * c'est la meme entite.
 */
export default fp(
  (fastify, _opts, done) => {
    const service = new FeedbackService(fastify.db);
    const support = [fastify.authenticate, requireSuperAdmin(fastify)];

    /**
     * Previent le support d'un nouveau signalement : un e-mail a la boite
     * support (repondre a l'e-mail ecrit a l'auteur) et un push aux super
     * admins. Sans cela, un signalement attendait que quelqu'un pense a ouvrir
     * la console.
     */
    const alertSupport = async (feedbackId: string) => {
      const feedback = await service.findByIdForSupport(feedbackId);
      if (!feedback) return;
      const authorName =
        [feedback.author_first_name, feedback.author_last_name].filter(Boolean).join(' ') || feedback.author_email || '—';

      const envois: Promise<void>[] = [];
      if (env.SUPPORT_EMAIL) {
        const { subject, html } = buildFeedbackAlertEmail({
          feedbackId,
          type: feedback.type,
          subject: feedback.subject,
          message: feedback.message,
          authorName,
          authorEmail: feedback.author_email,
          organizationName: feedback.organization_name,
          platform: feedback.platform,
          appVersion: feedback.app_version,
          screen: feedback.screen,
          feedbackLocale: feedback.locale,
          locale: env.SUPPORT_LOCALE,
        });
        envois.push(sendMail({ to: env.SUPPORT_EMAIL, subject, html, replyTo: feedback.author_email ?? undefined }));
      }
      // L'auteur, s'il est lui-meme super admin, sait deja ce qu'il vient d'ecrire.
      const recipients = (await service.superAdminIds()).filter((id) => id !== feedback.user_id);
      envois.push(
        sendPushToUsers(
          fastify.db,
          recipients,
          feedbackNewPush({ type: feedback.type, author: authorName, subject: feedback.subject, feedbackId }),
          fastify.log,
        ),
      );
      // Un canal en panne ne doit pas empecher l'autre de partir.
      for (const result of await Promise.allSettled(envois)) {
        if (result.status === 'rejected') fastify.log.error({ err: result.reason }, 'Feedback alert failed');
      }
    };

    // POST /feedbacks — deposer un signalement
    fastify.post('/feedbacks', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const data = createFeedbackSchema.parse(request.body);

      // L'organisation n'est qu'un element de contexte : quelqu'un sans
      // organisation active doit pouvoir signaler un bug malgre tout — c'est
      // meme probablement de cela qu'il veut parler.
      const membership = await getActiveMembership(fastify.db, request.user.sub);

      // La langue du message : celle que le client annonce, a defaut celle du
      // compte. Sans elle on repondrait au hasard.
      const auteur = await fastify.db('user').where({ id: request.user.sub }).select('locale').first();

      const [feedback] = await fastify
        .db('feedback')
        .insert({
          user_id: request.user.sub,
          organization_id: membership?.organization_id ?? null,
          type: data.type,
          subject: data.subject,
          message: data.message,
          platform: data.platform ?? null,
          app_version: data.app_version ?? null,
          screen: data.screen ?? null,
          locale: data.locale ?? auteur?.locale ?? 'fr',
        })
        .returning('*');

      // Detache : l'auteur n'attend ni le serveur d'e-mail ni Expo.
      alertSupport(feedback.id).catch((err) => fastify.log.error({ err }, 'Feedback alert failed'));

      return reply.code(201).send(feedback);
    });

    // GET /feedbacks/mine — ses propres signalements et les reponses recues
    fastify.get('/feedbacks/mine', { preHandler: [fastify.authenticate] }, async (request) => {
      const pagination = minePaginationSchema.parse(request.query);
      return service.findByUser(request.user.sub, pagination);
    });

    // GET /feedbacks/mine/:id — le detail d'un de ses signalements
    fastify.get('/feedbacks/mine/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidParamSchema.parse(request.params);
      const feedback = await service.findById(id);
      // Le signalement d'autrui est traite comme inexistant : repondre 403
      // confirmerait qu'il existe.
      if (!feedback || feedback.user_id !== request.user.sub) {
        return reply.notFound('Signalement introuvable');
      }
      return feedback;
    });

    // ---------- Console support ----------

    // GET /super-admin/feedbacks — tous les signalements, filtrables
    fastify.get('/super-admin/feedbacks', { preHandler: support }, async (request) => {
      const filters = listFeedbackSchema.parse(request.query);
      const [resultat, compteurs] = await Promise.all([
        service.findForSupport(filters),
        service.countByStatus(),
      ]);
      return { ...resultat, counts: compteurs };
    });

    // GET /super-admin/feedbacks/:id — fiche complete avec auteur
    fastify.get('/super-admin/feedbacks/:id', { preHandler: support }, async (request, reply) => {
      const { id } = uuidParamSchema.parse(request.params);
      const feedback = await service.findByIdForSupport(id);
      if (!feedback) return reply.notFound('Signalement introuvable');
      return feedback;
    });

    // PATCH /super-admin/feedbacks/:id — changer le statut, ecrire une reponse
    fastify.patch('/super-admin/feedbacks/:id', { preHandler: support }, async (request, reply) => {
      const { id } = uuidParamSchema.parse(request.params);
      const data = respondFeedbackSchema.parse(request.body);

      const existant = await service.findById(id);
      if (!existant) return reply.notFound('Signalement introuvable');

      const feedback = await service.respond(id, data, request.user.sub);

      // Notification a l'auteur, uniquement quand une reponse NOUVELLE est
      // ecrite. Un simple changement de statut ne vaut pas d'interrompre
      // quelqu'un, et reenregistrer le meme texte ne doit pas renotifier.
      const reponseNouvelle =
        typeof data.response === 'string' && data.response !== (existant.response ?? null);
      const auteurEstLeRepondant = existant.user_id === request.user.sub;

      if (reponseNouvelle && !auteurEstLeRepondant) {
        // Detache de la reponse HTTP : le support ne doit pas attendre l'API
        // d'Expo, et un echec d'envoi ne doit pas annuler une reponse deja
        // enregistree.
        (async () => {
          await sendPushToUser(
            fastify.db,
            existant.user_id,
            buildFeedbackReplyPush({
              feedbackId: id,
              subject: existant.subject,
              response: data.response as string,
              // La langue du signalement : c'est celle dans laquelle il a ete
              // ecrit, donc celle dans laquelle il est lu.
              locale: existant.locale,
            }),
            fastify.log,
          );
        })().catch((err) => fastify.log.error({ err }, 'Push send failed'));
      }

      // Trace d'audit, comme toute action de super admin : ecrire a un
      // utilisateur au nom du produit doit rester attribuable.
      await logAudit(fastify.db, {
        super_admin_id: request.user.sub,
        action: 'feedback.respond',
        target_type: 'feedback',
        target_id: id,
        metadata: { status: feedback?.status, a_repondu: data.response != null },
        ip: request.ip,
      });

      return feedback;
    });

    done();
  },
  { name: 'feedback-module' },
);
