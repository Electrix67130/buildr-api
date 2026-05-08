import fp from 'fastify-plugin';
import { z } from 'zod';
import ChantierTemplateService from './chantier-template.service';
import {
  createTemplateSchema,
  updateTemplateSchema,
  useTemplateSchema,
} from './chantier-template.schema';

const uuidSchema = z.object({ id: z.string().uuid() });

async function getUserOrgId(
  db: import('knex').Knex,
  userId: string,
): Promise<{ orgId: string; role: string } | undefined> {
  const row = await db('user')
    .leftJoin('organization_member', function () {
      this.on('organization_member.user_id', '=', 'user.id').andOn(
        'organization_member.organization_id',
        '=',
        'user.active_organization_id',
      );
    })
    .where('user.id', userId)
    .select('user.active_organization_id as organization_id', 'organization_member.role as role')
    .first();
  if (!row?.organization_id || !row.role) return undefined;
  return { orgId: row.organization_id, role: row.role };
}

/** Manager ou admin de l'organisation peuvent gerer les modeles. */
function canManage(role: string): boolean {
  return role === 'admin' || role === 'manager';
}

export default fp(
  (fastify, _opts, done) => {
    const service = new ChantierTemplateService(fastify.db);

    // GET /chantier-templates — list templates of the user's organization
    fastify.get('/chantier-templates', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const ctx = await getUserOrgId(fastify.db, request.user.sub);
      if (!ctx) return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Pas d\'organisation' });
      return service.findByOrgWithSteps(ctx.orgId);
    });

    // GET /chantier-templates/:id
    fastify.get('/chantier-templates/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const ctx = await getUserOrgId(fastify.db, request.user.sub);
      if (!ctx) return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Pas d\'organisation' });
      const template = await service.findByIdWithSteps(id);
      if (!template) return reply.notFound('Modèle introuvable');
      if (template.organization_id !== ctx.orgId) {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Accès refusé' });
      }
      return template;
    });

    // POST /chantier-templates — create
    fastify.post('/chantier-templates', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const ctx = await getUserOrgId(fastify.db, request.user.sub);
      if (!ctx) return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Pas d\'organisation' });
      if (!canManage(ctx.role)) {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Seul un manager ou admin peut créer un modèle' });
      }
      const data = createTemplateSchema.parse(request.body);
      const template = await service.createWithSteps(ctx.orgId, request.user.sub, data);
      return reply.code(201).send(template);
    });

    // PATCH /chantier-templates/:id — update
    fastify.patch('/chantier-templates/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const ctx = await getUserOrgId(fastify.db, request.user.sub);
      if (!ctx) return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Pas d\'organisation' });
      if (!canManage(ctx.role)) {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Permission refusée' });
      }
      const existing = await service.findById(id);
      if (!existing) return reply.notFound('Modèle introuvable');
      if (existing.organization_id !== ctx.orgId) {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Accès refusé' });
      }
      const data = updateTemplateSchema.parse(request.body);
      const updated = await service.updateWithSteps(id, data);
      return updated;
    });

    // DELETE /chantier-templates/:id
    fastify.delete('/chantier-templates/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const ctx = await getUserOrgId(fastify.db, request.user.sub);
      if (!ctx) return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Pas d\'organisation' });
      if (!canManage(ctx.role)) {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Permission refusée' });
      }
      const existing = await service.findById(id);
      if (!existing) return reply.notFound('Modèle introuvable');
      if (existing.organization_id !== ctx.orgId) {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Accès refusé' });
      }
      await service.delete(id);
      return reply.code(204).send();
    });

    // POST /chantier-templates/:id/use — create a chantier from this template
    // Body : { name, description?, address?, city?, postal_code?, latitude?, longitude?, start_date?, end_date? }
    fastify.post('/chantier-templates/:id/use', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const ctx = await getUserOrgId(fastify.db, request.user.sub);
      if (!ctx) return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Pas d\'organisation' });
      if (ctx.role !== 'admin') {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Seul un administrateur peut créer un chantier' });
      }
      const data = useTemplateSchema.parse(request.body);
      const template = await service.findByIdWithSteps(id);
      if (!template) return reply.notFound('Modèle introuvable');
      if (template.organization_id !== ctx.orgId) {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Accès refusé' });
      }

      // Cree le chantier + ses etapes/sous-etapes en transaction
      return fastify.db.transaction(async (trx) => {
        const [chantier] = await trx('chantier')
          .insert({
            name: data.name,
            description: data.description ?? template.description ?? null,
            address: data.address ?? null,
            city: data.city ?? null,
            postal_code: data.postal_code ?? null,
            latitude: data.latitude ?? null,
            longitude: data.longitude ?? null,
            status: template.default_status,
            start_date: data.start_date ?? null,
            end_date: data.end_date ?? null,
            created_by: request.user.sub,
            organization_id: ctx.orgId,
          })
          .returning('*');

        for (let i = 0; i < template.steps.length; i++) {
          const step = template.steps[i];
          const [stepRow] = await trx('chantier_step')
            .insert({ chantier_id: chantier.id, name: step.name, position: i })
            .returning('*');
          for (let j = 0; j < step.substeps.length; j++) {
            const sub = step.substeps[j];
            await trx('chantier_substep').insert({
              step_id: stepRow.id,
              name: sub.name,
              position: j,
            });
          }
        }

        // Copie des membres du modele dans chantier_member.
        // Mapping role global -> role chantier : admin/manager -> 'responsable', employee -> 'ouvrier'.
        if (template.members.length > 0) {
          const rows = template.members.map((m) => ({
            chantier_id: chantier.id,
            user_id: m.user_id,
            role:
              m.role === 'admin' || m.role === 'manager'
                ? 'responsable'
                : m.role === 'employee'
                  ? 'ouvrier'
                  : null,
          })).filter((r) => r.role !== null);
          if (rows.length > 0) {
            await trx('chantier_member')
              .insert(rows)
              .onConflict(['chantier_id', 'user_id'])
              .ignore();
          }
        }

        return reply.code(201).send(chantier);
      });
    });

    done();
  },
  { name: 'chantier-template-module' },
);
