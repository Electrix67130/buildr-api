import fp from 'fastify-plugin';
import { z } from 'zod';
import { Knex } from 'knex';
import ChantierEmergencyService from './chantier-emergency.service';
import { createEmergencySchema } from './chantier-emergency.schema';
import { signUrlsInList } from '@/lib/sign-url';
import { getActiveMembership } from '@/lib/active-membership';
import { emitToChantier } from '@/lib/realtime-hub';
import { sendPushToChantier } from '@/lib/push-notifications';
import { getActorAndChantierNames } from '@/lib/push-helpers';

const byChantierSchema = z.object({
  chantier_id: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const uuidSchema = z.object({ id: z.string().uuid() });

async function isAdminInActiveOrg(db: Knex, userId: string): Promise<boolean> {
  const m = await getActiveMembership(db, userId);
  return m?.role === 'admin';
}

/** Membre du chantier (view), ou admin / createur. */
async function isChantierMember(db: Knex, userId: string, chantierId: string): Promise<boolean> {
  if (await isAdminInActiveOrg(db, userId)) return true;
  const chantier = await db('chantier').where({ id: chantierId }).select('created_by').first();
  if (chantier?.created_by === userId) return true;
  const member = await db('chantier_member').where({ chantier_id: chantierId, user_id: userId }).first();
  return !!member;
}

/**
 * Peut creer une urgence/reclamation :
 * - admin OR createur du chantier OR membre avec role manager/ouvrier (urgences terrain)
 * - membre client (reclamations)
 * Le seul role exclu est gestionnaire_reseau (lecteur externe sans cas d'usage).
 */
async function canCreateEmergency(db: Knex, userId: string, chantierId: string): Promise<boolean> {
  if (await isAdminInActiveOrg(db, userId)) return true;
  const chantier = await db('chantier').where({ id: chantierId }).select('created_by').first();
  if (chantier?.created_by === userId) return true;
  const member = await db('chantier_member')
    .where({ chantier_id: chantierId, user_id: userId })
    .select('role')
    .first();
  return member?.role === 'manager' || member?.role === 'ouvrier' || member?.role === 'client';
}

/** Peut supprimer une urgence : son auteur OU admin OU createur OU manager du chantier. */
async function canDeleteEmergency(db: Knex, userId: string, chantierId: string, authorId: string): Promise<boolean> {
  if (authorId === userId) return true;
  if (await isAdminInActiveOrg(db, userId)) return true;
  const chantier = await db('chantier').where({ id: chantierId }).select('created_by').first();
  if (chantier?.created_by === userId) return true;
  const member = await db('chantier_member')
    .where({ chantier_id: chantierId, user_id: userId })
    .select('role')
    .first();
  return member?.role === 'manager';
}

export default fp(
  (fastify, _opts, done) => {
    const service = new ChantierEmergencyService(fastify.db);

    // GET /emergencies?chantier_id=xxx — list emergencies of a chantier
    fastify.get('/emergencies', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { chantier_id, ...pagination } = byChantierSchema.parse(request.query);
      if (!(await isChantierMember(fastify.db, request.user.sub, chantier_id))) {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Accès refusé' });
      }
      const result = await service.findByChantier(chantier_id, pagination);
      return { ...result, data: signUrlsInList(result.data) };
    });

    // POST /emergencies — create (admin / createur / manager / ouvrier ; PAS client ni gestionnaire_reseau)
    fastify.post('/emergencies', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const data = createEmergencySchema.parse(request.body);
      if (!(await canCreateEmergency(fastify.db, request.user.sub, data.chantier_id))) {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Seuls manager, ouvrier et admin peuvent créer une urgence' });
      }
      const created = await service.create({ ...data, created_by: request.user.sub });
      const [signed] = signUrlsInList([created]);
      emitToChantier(fastify.db, data.chantier_id, {
        type: 'emergency.created',
        chantier_id: data.chantier_id,
        resource_id: created.id,
        actor_id: request.user.sub,
      }).catch((err) => fastify.log.error({ err }, 'WS emit failed'));
      (async () => {
        const { actorName, chantierName } = await getActorAndChantierNames(fastify.db, request.user.sub, data.chantier_id);
        // Determiner urgence vs reclamation pour le wording.
        const member = await fastify.db('chantier_member')
          .where({ chantier_id: data.chantier_id, user_id: request.user.sub })
          .select('role')
          .first();
        const isClaim = member?.role === 'client';
        await sendPushToChantier(
          fastify.db,
          data.chantier_id,
          request.user.sub,
          {
            title: isClaim ? `📢 Réclamation — ${chantierName}` : `🚨 Urgence — ${chantierName}`,
            body: isClaim ? `${actorName} a fait une réclamation` : `${actorName} a signalé une urgence`,
            data: { type: 'emergency', chantier_id: data.chantier_id, emergency_id: created.id },
          },
          fastify.log,
        );
      })().catch((err) => fastify.log.error({ err }, 'Push send failed'));
      return reply.code(201).send(signed);
    });

    // DELETE /emergencies/:id — author / admin / creator / manager
    fastify.delete('/emergencies/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const existing = await service.findById(id);
      if (!existing) return reply.notFound('Urgence introuvable');
      const ok = await canDeleteEmergency(fastify.db, request.user.sub, existing.chantier_id, existing.created_by);
      if (!ok) {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Permission refusée' });
      }
      await service.delete(id);
      emitToChantier(fastify.db, existing.chantier_id, {
        type: 'emergency.deleted',
        chantier_id: existing.chantier_id,
        resource_id: id,
        actor_id: request.user.sub,
      }).catch((err) => fastify.log.error({ err }, 'WS emit failed'));
      return reply.code(204).send();
    });

    done();
  },
  { name: 'chantier-emergency-module' },
);
