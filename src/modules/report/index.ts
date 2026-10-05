import fp from 'fastify-plugin';
import { z } from 'zod';
import ReportService from './report.service';
import { createReportSchema, resolveReportSchema, listReportsSchema } from './report.schema';
import { getActiveMembership } from '@/lib/active-membership';
import { requireSuperAdmin } from '@/lib/super-admin';
import { emitToUser } from '@/lib/realtime-hub';
import { sendPushToUsers } from '@/lib/push-notifications';
import { reportPush } from '@/lib/push-i18n';

const uuidSchema = z.object({ id: z.string().uuid() });

export default fp(
  (fastify, _opts, done) => {
    const service = new ReportService(fastify.db);
    const support = [fastify.authenticate, requireSuperAdmin(fastify)];

    /** L'appelant est-il super admin ? (lecture directe, le guard n'est pas pose ici) */
    const isSuperAdmin = async (userId: string): Promise<boolean> => {
      const u = await fastify.db('user').where({ id: userId }).select('is_super_admin').first();
      return !!u?.is_super_admin;
    };

    // POST /reports — signaler un message, une photo ou un membre
    fastify.post('/reports', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const data = createReportSchema.parse(request.body);
      const target = await service.resolveTarget(data, request.user.sub);
      // 404 et non 403 : dire « interdit » confirmerait que la cible existe.
      if (!target) return reply.notFound('Cible introuvable');
      if (target.target_user_id === request.user.sub) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'On ne se signale pas soi-même' });
      }

      // Idempotent : re-signaler la meme chose ne cree pas un doublon, on rend
      // le signalement deja ouvert.
      const duplicate = await service.findPendingDuplicate(request.user.sub, data);
      if (duplicate) return reply.code(200).send(duplicate);

      const escalated = await service.isOrgAdmin(target.target_user_id, target.organization_id);
      const report = await service.create({
        organization_id: target.organization_id,
        chantier_id: target.chantier_id,
        reporter_id: request.user.sub,
        target_type: data.target_type,
        target_id: data.target_id,
        target_user_id: target.target_user_id,
        target_excerpt: target.excerpt,
        reason: data.reason,
        comment: data.comment ?? null,
        escalated,
      } as Partial<typeof duplicate & object>);

      // Previent les administrateurs de l'organisation — jamais la personne
      // visee — et la console si c'est un administrateur qui est vise.
      (async () => {
        const admins = await service.adminsToNotify(target.organization_id, [target.target_user_id, request.user.sub]);
        const recipients = new Set(admins);
        if (escalated) for (const id of await service.superAdminIds()) if (id !== request.user.sub && id !== target.target_user_id) recipients.add(id);
        const where = target.chantier_id
          ? ((await fastify.db('chantier').where({ id: target.chantier_id }).select('name').first())?.name as string | undefined)
          : ((await fastify.db('organization').where({ id: target.organization_id }).select('name').first())?.name as string | undefined);
        for (const id of recipients) emitToUser(id, { type: 'report.created', chantier_id: target.chantier_id ?? undefined, resource_id: report.id, actor_id: request.user.sub });
        await sendPushToUsers(fastify.db, [...recipients], reportPush({ where: where ?? '', reportId: report.id }), fastify.log);
      })().catch((err) => fastify.log.error({ err }, 'Report notify failed'));

      return reply.code(201).send(report);
    });

    // GET /reports — les signalements de son organisation (administrateurs)
    fastify.get('/reports', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const filters = listReportsSchema.parse(request.query);
      const membership = await getActiveMembership(fastify.db, request.user.sub);
      if (membership?.role !== 'admin') {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Réservé aux administrateurs' });
      }
      return service.listForOrganization(membership.organization_id, request.user.sub, filters);
    });

    // PATCH /reports/:id — traiter ou rejeter (administrateur de l'organisation, ou console)
    fastify.patch('/reports/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const data = resolveReportSchema.parse(request.body);
      const existing = await service.findById(id);
      if (!existing) return reply.notFound('Signalement introuvable');

      const superAdmin = await isSuperAdmin(request.user.sub);
      if (!superAdmin) {
        const m = await fastify.db('organization_member')
          .where({ user_id: request.user.sub, organization_id: existing.organization_id })
          .first();
        // La personne visee ne traite pas le signalement qui la concerne.
        if (m?.role !== 'admin' || existing.target_user_id === request.user.sub) {
          return reply.notFound('Signalement introuvable');
        }
      }
      return service.resolve(id, data, request.user.sub);
    });

    // GET /super-admin/reports — tous les signalements, pour la console
    fastify.get('/super-admin/reports', { preHandler: support }, async (request) => {
      const filters = listReportsSchema
        .extend({ escalated: z.enum(['1', 'true']).optional(), organization_id: z.string().uuid().optional() })
        .parse(request.query);
      return service.listAll({ ...filters, escalated: !!filters.escalated });
    });

    done();
  },
  { name: 'report-module' },
);
