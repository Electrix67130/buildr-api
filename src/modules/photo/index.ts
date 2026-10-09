import fp from 'fastify-plugin';
import { z } from 'zod';
import PhotoService from './photo.service';
import { createPhotoSchema } from './photo.schema';
import { signUrlsInList } from '@/lib/sign-url';
import { emitToChantier } from '@/lib/realtime-hub';
import { sendPushToChantier } from '@/lib/push-notifications';
import { photoAddedPush } from '@/lib/push-i18n';
import { getActorAndChantierNames } from '@/lib/push-helpers';
import { requirePermission } from '@/lib/permissions';

const byChantierSchema = z.object({
  chantier_id: z.string().uuid(),
  /** Ne renvoyer que les photos rattachees a cette etape (sous-etapes comprises). */
  step_id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const uuidSchema = z.object({ id: z.string().uuid() });

export default fp(
  (fastify, _opts, done) => {
    const service = new PhotoService(fastify.db);

    // GET /photos?chantier_id=xxx — requires view_photos
    fastify.get('/photos', { preHandler: [fastify.authenticate] }, async (request) => {
      const { chantier_id, step_id, ...pagination } = byChantierSchema.parse(request.query);
      await requirePermission(fastify.db, request.user.sub, chantier_id, 'view_photos');
      const result = await service.findByChantier(chantier_id, pagination, step_id, request.user.sub);
      return { ...result, data: signUrlsInList(result.data) };
    });

    // GET /photos/:id
    fastify.get('/photos/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const photo = await service.findById(id);
      if (!photo) return reply.notFound('Photo not found');
      await requirePermission(fastify.db, request.user.sub, photo.chantier_id, 'view_photos');
      return photo;
    });

    // POST /photos — requires edit
    fastify.post('/photos', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const data = createPhotoSchema.parse(request.body);
      await requirePermission(fastify.db, request.user.sub, data.chantier_id, 'edit');

      // Une photo de sous-etape porte aussi son etape, pour que la galerie
      // puisse filtrer par etape sans connaitre l'arborescence. L'etape doit
      // appartenir au chantier : sinon on pourrait accrocher une photo a
      // l'etape d'un autre chantier et la faire apparaitre chez lui.
      if (data.substep_id) {
        const sub = await fastify.db('chantier_substep')
          .join('chantier_step', 'chantier_step.id', 'chantier_substep.step_id')
          .where('chantier_substep.id', data.substep_id)
          .select('chantier_step.id as step_id', 'chantier_step.chantier_id')
          .first();
        if (!sub || sub.chantier_id !== data.chantier_id) return reply.badRequest("Cette sous-étape n'appartient pas à ce chantier");
        data.step_id = sub.step_id;
      } else if (data.step_id) {
        const step = await fastify.db('chantier_step').where({ id: data.step_id }).select('chantier_id').first();
        if (!step || step.chantier_id !== data.chantier_id) return reply.badRequest("Cette étape n'appartient pas à ce chantier");
      }

      const photo = await service.create({ ...data, uploaded_by: request.user.sub });
      emitToChantier(fastify.db, data.chantier_id, {
        type: 'photo.created',
        chantier_id: data.chantier_id,
        resource_id: photo.id,
        actor_id: request.user.sub,
      }).catch((err) => fastify.log.error({ err }, 'WS emit failed'));
      (async () => {
        const { actorName, chantierName } = await getActorAndChantierNames(fastify.db, request.user.sub, data.chantier_id);
        await sendPushToChantier(
          fastify.db,
          data.chantier_id,
          request.user.sub,
          photoAddedPush({ chantierName, actorName, chantierId: data.chantier_id }),
          fastify.log,
          { access: 'view_photos' },
        );
      })().catch((err) => fastify.log.error({ err }, 'Push send failed'));
      return reply.code(201).send(photo);
    });

    // DELETE /photos/:id — uploader or edit permission
    fastify.delete('/photos/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const existing = await service.findById(id);
      if (!existing) return reply.notFound('Photo not found');
      if (existing.uploaded_by !== request.user.sub) {
        await requirePermission(fastify.db, request.user.sub, existing.chantier_id, 'edit');
      }
      await service.delete(id);
      emitToChantier(fastify.db, existing.chantier_id, {
        type: 'photo.deleted',
        chantier_id: existing.chantier_id,
        resource_id: id,
        actor_id: request.user.sub,
      }).catch((err) => fastify.log.error({ err }, 'WS emit failed'));
      return reply.code(204).send();
    });

    done();
  },
  { name: 'photo-module' },
);
