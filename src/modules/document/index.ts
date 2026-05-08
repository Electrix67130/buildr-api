import fp from 'fastify-plugin';
import { z } from 'zod';
import DocumentService from './document.service';
import { createDocumentSchema } from './document.schema';
import { signUrlsInList } from '@/lib/sign-url';
import { getActiveMembership } from '@/lib/active-membership';
import { emitToChantier } from '@/lib/realtime-hub';
import { sendPushToChantier } from '@/lib/push-notifications';
import { getActorAndChantierNames, truncate } from '@/lib/push-helpers';
import { requirePermission } from '@/lib/permissions';

const byChantierSchema = z.object({
  chantier_id: z.string().uuid(),
  type: z.enum(['dict', 'dt', 'bon_de_commande', 'plan', 'arrete', 'facture', 'autre']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const uuidSchema = z.object({ id: z.string().uuid() });

export default fp(
  (fastify, _opts, done) => {
    const service = new DocumentService(fastify.db);

    // Gestionnaire reseau : acces limite aux documents de type DICT uniquement.
    // Cette restriction s'applique meme si l'utilisateur a can_view_documents=true.
    const restrictTypeForRole = async (userId: string, requestedType?: string): Promise<string | undefined> => {
      const m = await getActiveMembership(fastify.db, userId);
      if (m?.role === 'gestionnaire_reseau') {
        // Force le filtre type='dict', meme si un autre type est demande.
        return 'dict';
      }
      return requestedType;
    };

    // GET /documents?chantier_id=xxx&type=xxx — requires view_documents
    fastify.get('/documents', { preHandler: [fastify.authenticate] }, async (request) => {
      const { chantier_id, type, ...pagination } = byChantierSchema.parse(request.query);
      await requirePermission(fastify.db, request.user.sub, chantier_id, 'view_documents');
      const effectiveType = await restrictTypeForRole(request.user.sub, type);
      const result = await service.findByChantier(chantier_id, { ...pagination, type: effectiveType });
      return { ...result, data: signUrlsInList(result.data) };
    });

    // GET /documents/:id
    fastify.get('/documents/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const doc = await service.findById(id);
      if (!doc) return reply.notFound('Document not found');
      await requirePermission(fastify.db, request.user.sub, doc.chantier_id, 'view_documents');
      // Bloque l'acces a un doc non-DICT pour le gestionnaire reseau.
      const restrictedType = await restrictTypeForRole(request.user.sub);
      if (restrictedType && doc.type !== restrictedType) {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Type de document non accessible' });
      }
      return doc;
    });

    // POST /documents — requires edit
    fastify.post('/documents', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const data = createDocumentSchema.parse(request.body);
      await requirePermission(fastify.db, request.user.sub, data.chantier_id, 'edit');
      const doc = await service.create({ ...data, uploaded_by: request.user.sub });
      emitToChantier(fastify.db, data.chantier_id, {
        type: 'document.created',
        chantier_id: data.chantier_id,
        resource_id: doc.id,
        actor_id: request.user.sub,
      }).catch((err) => fastify.log.error({ err }, 'WS emit failed'));
      (async () => {
        const { actorName, chantierName } = await getActorAndChantierNames(fastify.db, request.user.sub, data.chantier_id);
        await sendPushToChantier(
          fastify.db,
          data.chantier_id,
          request.user.sub,
          {
            title: `📄 ${chantierName}`,
            body: `${actorName} a ajouté un document : ${truncate(data.name, 60)}`,
            data: { type: 'document', chantier_id: data.chantier_id },
          },
          fastify.log,
        );
      })().catch((err) => fastify.log.error({ err }, 'Push send failed'));
      return reply.code(201).send(doc);
    });

    // DELETE /documents/:id — uploader or edit permission
    fastify.delete('/documents/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const existing = await service.findById(id);
      if (!existing) return reply.notFound('Document not found');
      if (existing.uploaded_by !== request.user.sub) {
        await requirePermission(fastify.db, request.user.sub, existing.chantier_id, 'edit');
      }
      await service.delete(id);
      emitToChantier(fastify.db, existing.chantier_id, {
        type: 'document.deleted',
        chantier_id: existing.chantier_id,
        resource_id: id,
        actor_id: request.user.sub,
      }).catch((err) => fastify.log.error({ err }, 'WS emit failed'));
      return reply.code(204).send();
    });

    done();
  },
  { name: 'document-module' },
);
