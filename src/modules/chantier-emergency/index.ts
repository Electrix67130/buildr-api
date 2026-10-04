import fp from 'fastify-plugin';
import { z } from 'zod';
import { Knex } from 'knex';
import ChantierEmergencyService from './chantier-emergency.service';
import { createEmergencySchema, addEmergencyPhotosSchema } from './chantier-emergency.schema';
import { signUrlsInList } from '@/lib/sign-url';
import { isChantierAdminOrCreator, isChantierParticipant } from '@/lib/permissions';
import { emitToChantier } from '@/lib/realtime-hub';
import { requirePermission } from '@/lib/permissions';
import { sendPushToChantier } from '@/lib/push-notifications';
import { emergencyPush } from '@/lib/push-i18n';
import { getActorAndChantierNames } from '@/lib/push-helpers';

const byChantierSchema = z.object({
  chantier_id: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const uuidSchema = z.object({ id: z.string().uuid() });

/**
 * Peut creer une urgence/reclamation :
 * - admin OR createur du chantier OR membre avec role manager/ouvrier (urgences terrain)
 * - membre client (reclamations)
 * Le seul role exclu est gestionnaire_reseau (lecteur externe sans cas d'usage).
 */
async function canCreateEmergency(db: Knex, userId: string, chantierId: string): Promise<boolean> {
  if (await isChantierAdminOrCreator(db, userId, chantierId)) return true;
  const member = await db('chantier_member')
    .where({ chantier_id: chantierId, user_id: userId })
    .select('role')
    .first();
  return member?.role === 'manager' || member?.role === 'ouvrier' || member?.role === 'client';
}

/** Peut supprimer une urgence : son auteur OU admin OU createur OU manager du chantier. */
async function canDeleteEmergency(db: Knex, userId: string, chantierId: string, authorId: string): Promise<boolean> {
  if (authorId === userId) return true;
  if (await isChantierAdminOrCreator(db, userId, chantierId)) return true;
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
      if (!(await isChantierParticipant(fastify.db, request.user.sub, chantier_id))) {
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
      // Les photos vont dans la galerie ; `photo_url` garde la premiere pour
      // les clients qui ne lisent pas encore `photos`.
      const { photos: photoInputs = [], ...fields } = data;
      const firstPhoto = photoInputs[0];
      const created = await service.create({
        ...fields,
        photo_url: fields.photo_url ?? firstPhoto?.url ?? null,
        thumbnail_url: fields.thumbnail_url ?? firstPhoto?.thumbnail_url ?? null,
        created_by: request.user.sub,
      });
      const allInputs = photoInputs.length > 0
        ? photoInputs
        : fields.photo_url
          ? [{ url: fields.photo_url, thumbnail_url: fields.thumbnail_url }]
          : [];
      const photos = await service.addPhotos(created, request.user.sub, allInputs);
      const [signed] = signUrlsInList([{ ...created, photos }]);
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
          emergencyPush({ chantierName, actorName, chantierId: data.chantier_id, emergencyId: created.id, isClaim }),
          fastify.log,
        );
      })().catch((err) => fastify.log.error({ err }, 'Push send failed'));
      return reply.code(201).send(signed);
    });

    // DELETE /emergencies/:id — author / admin / creator / manager
    // POST /emergencies/:id/photos — ajouter des photos apres coup (auteur, ou droit d'edition)
    fastify.post('/emergencies/:id/photos', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const { photos: inputs } = addEmergencyPhotosSchema.parse(request.body);
      const existing = await service.findById(id);
      if (!existing) return reply.notFound('Emergency not found');
      if (existing.created_by !== request.user.sub) {
        await requirePermission(fastify.db, request.user.sub, existing.chantier_id, 'edit');
      }
      const photos = await service.addPhotos(existing, request.user.sub, inputs);
      emitToChantier(fastify.db, existing.chantier_id, {
        type: 'emergency.created',
        chantier_id: existing.chantier_id,
        resource_id: id,
        actor_id: request.user.sub,
      }).catch((err) => fastify.log.error({ err }, 'WS emit failed'));
      return { emergency_id: id, photos: signUrlsInList(photos) };
    });

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
