import { Knex } from 'knex';
import BaseService from '@/lib/base-service';
import { ChantierStepRow, ChantierSubstepRow, StepWithSubsteps, StepPhoto } from './chantier-step.schema';

class ChantierStepService extends BaseService<ChantierStepRow> {
  constructor(db: Knex) {
    super(db, 'chantier_step');
  }

  async findByChantierWithSubsteps(chantierId: string): Promise<StepWithSubsteps[]> {
    const steps = (await this.db('chantier_step')
      .where({ chantier_id: chantierId })
      .orderBy('position', 'asc')
      .orderBy('created_at', 'asc')) as ChantierStepRow[];

    if (steps.length === 0) return [];

    const stepIds = steps.map((s) => s.id);
    const substeps = (await this.db('chantier_substep')
      .whereIn('step_id', stepIds)
      .orderBy('position', 'asc')
      .orderBy('created_at', 'asc')) as ChantierSubstepRow[];

    // Les photos qui attestent une etape ou une sous-etape, servies avec elles
    // pour que les clients n'aient pas a croiser la galerie avec l'arbre.
    const photos = (await this.db('photo')
      .where({ chantier_id: chantierId })
      .whereNotNull('step_id')
      .select('id', 'url', 'thumbnail_url', 'step_id', 'substep_id', 'created_at')
      .orderBy('created_at', 'asc')) as StepPhoto[];
    const stepPhotos = new Map<string, StepPhoto[]>();
    const substepPhotos = new Map<string, StepPhoto[]>();
    for (const p of photos) {
      const target = p.substep_id ? substepPhotos : stepPhotos;
      const key = p.substep_id ?? p.step_id;
      target.set(key, [...(target.get(key) ?? []), p]);
    }

    const bucketed = new Map<string, (ChantierSubstepRow & { photos: StepPhoto[] })[]>();
    for (const sub of substeps) {
      const arr = bucketed.get(sub.step_id) ?? [];
      arr.push({ ...sub, photos: substepPhotos.get(sub.id) ?? [] });
      bucketed.set(sub.step_id, arr);
    }

    return steps.map((s) => ({ ...s, substeps: bucketed.get(s.id) ?? [], photos: stepPhotos.get(s.id) ?? [] }));
  }

  async createForChantier(chantierId: string, name: string): Promise<ChantierStepRow> {
    const [{ max_position }] = (await this.db('chantier_step')
      .where({ chantier_id: chantierId })
      .max('position as max_position')) as { max_position: number | null }[];
    const position = (max_position ?? -1) + 1;

    const [row] = await this.db('chantier_step').insert({ chantier_id: chantierId, name, position }).returning('*');
    return row as ChantierStepRow;
  }

  async reorder(chantierId: string, orderedIds: string[]): Promise<void> {
    await this.db.transaction(async (trx) => {
      const existing = (await trx('chantier_step').where({ chantier_id: chantierId }).select('id')) as { id: string }[];
      const existingSet = new Set(existing.map((r) => r.id));
      for (const id of orderedIds) {
        if (!existingSet.has(id)) throw Object.assign(new Error(`Step ${id} does not belong to chantier ${chantierId}`), { statusCode: 400 });
      }
      for (let i = 0; i < orderedIds.length; i++) {
        await trx('chantier_step').where({ id: orderedIds[i] }).update({ position: i, updated_at: trx.fn.now() });
      }
    });
  }

  async setValidation(
    id: string,
    validated: boolean,
    userId: string | null,
    comment: string | null | undefined,
  ): Promise<ChantierStepRow | undefined> {
    const update: Record<string, unknown> = {
      validated_at: validated ? this.db.fn.now() : null,
      validated_by: validated ? userId : null,
      updated_at: this.db.fn.now(),
    };
    if (comment !== undefined) update.validation_comment = comment;

    const [row] = await this.db('chantier_step').where({ id }).update(update).returning('*');
    return row as ChantierStepRow | undefined;
  }
}

export class ChantierSubstepService extends BaseService<ChantierSubstepRow> {
  constructor(db: Knex) {
    super(db, 'chantier_substep');
  }

  async createForStep(stepId: string, name: string): Promise<ChantierSubstepRow> {
    const [{ max_position }] = (await this.db('chantier_substep')
      .where({ step_id: stepId })
      .max('position as max_position')) as { max_position: number | null }[];
    const position = (max_position ?? -1) + 1;

    const [row] = await this.db('chantier_substep').insert({ step_id: stepId, name, position }).returning('*');
    return row as ChantierSubstepRow;
  }

  async reorder(stepId: string, orderedIds: string[]): Promise<void> {
    await this.db.transaction(async (trx) => {
      const existing = (await trx('chantier_substep').where({ step_id: stepId }).select('id')) as { id: string }[];
      const existingSet = new Set(existing.map((r) => r.id));
      for (const id of orderedIds) {
        if (!existingSet.has(id)) throw Object.assign(new Error(`Substep ${id} does not belong to step ${stepId}`), { statusCode: 400 });
      }
      for (let i = 0; i < orderedIds.length; i++) {
        await trx('chantier_substep').where({ id: orderedIds[i] }).update({ position: i, updated_at: trx.fn.now() });
      }
    });
  }

  async setValidation(
    id: string,
    validated: boolean,
    userId: string | null,
    comment: string | null | undefined,
  ): Promise<ChantierSubstepRow | undefined> {
    const update: Record<string, unknown> = {
      validated_at: validated ? this.db.fn.now() : null,
      validated_by: validated ? userId : null,
      updated_at: this.db.fn.now(),
    };
    if (comment !== undefined) update.validation_comment = comment;

    const [row] = await this.db('chantier_substep').where({ id }).update(update).returning('*');
    return row as ChantierSubstepRow | undefined;
  }
}

export default ChantierStepService;
