import fp from 'fastify-plugin';
import { z } from 'zod';
import { Knex } from 'knex';
import ChantierStepService, { ChantierSubstepService } from './chantier-step.service';
import { getActiveMembership } from '@/lib/active-membership';
import { sendPushToChantier } from '@/lib/push-notifications';
import { getActorAndChantierNames } from '@/lib/push-helpers';
import {
  createStepSchema,
  updateStepSchema,
  reorderStepsSchema,
  createSubstepSchema,
  updateSubstepSchema,
  reorderSubstepsSchema,
  toggleSubstepSchema,
  toggleStepSchema,
} from './chantier-step.schema';

const uuidSchema = z.object({ id: z.string().uuid() });
const chantierParamSchema = z.object({ chantier_id: z.string().uuid() });

/**
 * Can manage steps/substeps (create/edit/delete/reorder):
 * admin OR chantier creator OR (manager + member of chantier) OR (member with can_edit)
 */
async function canManageSteps(db: Knex, userId: string, chantierId: string): Promise<boolean> {
  const _m = await getActiveMembership(db, userId);
  if (_m?.role === 'admin') return true;

  const chantier = await db('chantier').where({ id: chantierId }).select('created_by').first();
  if (chantier?.created_by === userId) return true;

  const member = await db('chantier_member')
    .where({ chantier_id: chantierId, user_id: userId })
    .select('role', 'can_edit')
    .first();
  if (!member) return false;
  if (member.role === 'manager') return true;
  return !!member.can_edit;
}

/**
 * Can toggle substep validation: any chantier member except role='client', plus admin and creator.
 */
async function canToggleValidation(db: Knex, userId: string, chantierId: string): Promise<boolean> {
  const _m = await getActiveMembership(db, userId);
  if (_m?.role === 'admin') return true;

  const chantier = await db('chantier').where({ id: chantierId }).select('created_by').first();
  if (chantier?.created_by === userId) return true;

  const member = await db('chantier_member').where({ chantier_id: chantierId, user_id: userId }).select('role').first();
  if (!member) return false;
  return member.role !== 'client';
}

/**
 * Can view steps: admin OR creator OR member with can_view_steps=true.
 */
async function canViewSteps(db: Knex, userId: string, chantierId: string): Promise<boolean> {
  const _m = await getActiveMembership(db, userId);
  if (_m?.role === 'admin') return true;

  const chantier = await db('chantier').where({ id: chantierId }).select('created_by').first();
  if (chantier?.created_by === userId) return true;

  const member = await db('chantier_member')
    .where({ chantier_id: chantierId, user_id: userId })
    .select('can_view_steps')
    .first();
  return !!member?.can_view_steps;
}

async function getChantierIdFromStep(db: Knex, stepId: string): Promise<string | undefined> {
  const row = await db('chantier_step').where({ id: stepId }).select('chantier_id').first();
  return row?.chantier_id;
}

async function getChantierIdFromSubstep(db: Knex, substepId: string): Promise<string | undefined> {
  const row = await db('chantier_substep')
    .where({ 'chantier_substep.id': substepId })
    .join('chantier_step', 'chantier_substep.step_id', 'chantier_step.id')
    .select('chantier_step.chantier_id as chantier_id')
    .first();
  return row?.chantier_id;
}

export default fp(
  (fastify, _opts, done) => {
    const stepService = new ChantierStepService(fastify.db);
    const substepService = new ChantierSubstepService(fastify.db);

    // GET /chantiers/:chantier_id/steps — list steps with nested substeps
    fastify.get(
      '/chantiers/:chantier_id/steps',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { chantier_id } = chantierParamSchema.parse(request.params);
        if (!(await canViewSteps(fastify.db, request.user.sub, chantier_id))) {
          return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Accès refusé' });
        }
        return stepService.findByChantierWithSubsteps(chantier_id);
      },
    );

    // POST /chantier-steps — create a step
    fastify.post('/chantier-steps', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const data = createStepSchema.parse(request.body);
      if (!(await canManageSteps(fastify.db, request.user.sub, data.chantier_id))) {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Seul un manager ou admin peut créer des étapes' });
      }
      const step = await stepService.createForChantier(data.chantier_id, data.name);
      return reply.code(201).send(step);
    });

    // PATCH /chantier-steps/:id — rename step
    fastify.patch('/chantier-steps/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const data = updateStepSchema.parse(request.body);
      const chantierId = await getChantierIdFromStep(fastify.db, id);
      if (!chantierId) return reply.notFound('Étape introuvable');
      if (!(await canManageSteps(fastify.db, request.user.sub, chantierId))) {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Permission refusée' });
      }
      const step = await stepService.update(id, data);
      return step;
    });

    // DELETE /chantier-steps/:id
    fastify.delete('/chantier-steps/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const chantierId = await getChantierIdFromStep(fastify.db, id);
      if (!chantierId) return reply.notFound('Étape introuvable');
      if (!(await canManageSteps(fastify.db, request.user.sub, chantierId))) {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Permission refusée' });
      }
      await stepService.delete(id);
      return reply.code(204).send();
    });

    // POST /chantiers/:chantier_id/steps/reorder
    fastify.post(
      '/chantiers/:chantier_id/steps/reorder',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { chantier_id } = chantierParamSchema.parse(request.params);
        const { ordered_ids } = reorderStepsSchema.parse(request.body);
        if (!(await canManageSteps(fastify.db, request.user.sub, chantier_id))) {
          return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Permission refusée' });
        }
        await stepService.reorder(chantier_id, ordered_ids);
        return reply.code(204).send();
      },
    );

    // POST /chantier-substeps — create a substep
    fastify.post('/chantier-substeps', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const data = createSubstepSchema.parse(request.body);
      const chantierId = await getChantierIdFromStep(fastify.db, data.step_id);
      if (!chantierId) return reply.notFound('Étape introuvable');
      if (!(await canManageSteps(fastify.db, request.user.sub, chantierId))) {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Permission refusée' });
      }
      const substep = await substepService.createForStep(data.step_id, data.name);
      return reply.code(201).send(substep);
    });

    // PATCH /chantier-substeps/:id — rename or update comment
    fastify.patch('/chantier-substeps/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const data = updateSubstepSchema.parse(request.body);
      const chantierId = await getChantierIdFromSubstep(fastify.db, id);
      if (!chantierId) return reply.notFound('Sous-étape introuvable');
      if (!(await canManageSteps(fastify.db, request.user.sub, chantierId))) {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Permission refusée' });
      }
      const substep = await substepService.update(id, data);
      return substep;
    });

    // DELETE /chantier-substeps/:id
    fastify.delete('/chantier-substeps/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
      const { id } = uuidSchema.parse(request.params);
      const chantierId = await getChantierIdFromSubstep(fastify.db, id);
      if (!chantierId) return reply.notFound('Sous-étape introuvable');
      if (!(await canManageSteps(fastify.db, request.user.sub, chantierId))) {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Permission refusée' });
      }
      await substepService.delete(id);
      return reply.code(204).send();
    });

    // POST /chantier-steps/:id/substeps/reorder
    fastify.post(
      '/chantier-steps/:id/substeps/reorder',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const { ordered_ids } = reorderSubstepsSchema.parse(request.body);
        const chantierId = await getChantierIdFromStep(fastify.db, id);
        if (!chantierId) return reply.notFound('Étape introuvable');
        if (!(await canManageSteps(fastify.db, request.user.sub, chantierId))) {
          return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Permission refusée' });
        }
        await substepService.reorder(id, ordered_ids);
        return reply.code(204).send();
      },
    );

    // POST /chantier-substeps/:id/toggle — validate or unvalidate (any non-client member)
    fastify.post(
      '/chantier-substeps/:id/toggle',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const data = toggleSubstepSchema.parse(request.body);
        const chantierId = await getChantierIdFromSubstep(fastify.db, id);
        if (!chantierId) return reply.notFound('Sous-étape introuvable');
        if (!(await canToggleValidation(fastify.db, request.user.sub, chantierId))) {
          return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Les clients ne peuvent pas valider' });
        }
        const updated = await substepService.setValidation(
          id,
          data.validated,
          data.validated ? request.user.sub : null,
          data.validation_comment,
        );
        if (!updated) return reply.notFound('Sous-étape introuvable');
        // Push uniquement quand la sous-etape est VALIDEE (pas devalidee).
        if (data.validated) {
          (async () => {
            const { actorName, chantierName } = await getActorAndChantierNames(fastify.db, request.user.sub, chantierId);
            await sendPushToChantier(
              fastify.db,
              chantierId,
              request.user.sub,
              {
                title: `✅ ${chantierName}`,
                body: `${actorName} a validé : ${updated.name}`,
                data: { type: 'substep-validated', chantier_id: chantierId, substep_id: id },
              },
              fastify.log,
            );
          })().catch((err) => fastify.log.error({ err }, 'Push send failed'));
        }
        return updated;
      },
    );

    // POST /chantier-steps/:id/toggle — validate or unvalidate the step itself
    fastify.post(
      '/chantier-steps/:id/toggle',
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const { id } = uuidSchema.parse(request.params);
        const data = toggleStepSchema.parse(request.body);
        const chantierId = await getChantierIdFromStep(fastify.db, id);
        if (!chantierId) return reply.notFound('Étape introuvable');
        if (!(await canToggleValidation(fastify.db, request.user.sub, chantierId))) {
          return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Les clients ne peuvent pas valider' });
        }
        const updated = await stepService.setValidation(
          id,
          data.validated,
          data.validated ? request.user.sub : null,
          data.validation_comment,
        );
        if (!updated) return reply.notFound('Étape introuvable');
        if (data.validated) {
          (async () => {
            const { actorName, chantierName } = await getActorAndChantierNames(fastify.db, request.user.sub, chantierId);
            await sendPushToChantier(
              fastify.db,
              chantierId,
              request.user.sub,
              {
                title: `✅ ${chantierName}`,
                body: `${actorName} a validé l'étape : ${updated.name}`,
                data: { type: 'step-validated', chantier_id: chantierId, step_id: id },
              },
              fastify.log,
            );
          })().catch((err) => fastify.log.error({ err }, 'Push send failed'));
        }
        return updated;
      },
    );

    done();
  },
  { name: 'chantier-step-module' },
);
