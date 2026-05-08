import { Knex } from 'knex';
import BaseService from '@/lib/base-service';
import {
  TemplateRow,
  TemplateStepRow,
  TemplateSubstepRow,
  TemplateWithSteps,
  TemplateMemberWithUser,
  CreateTemplate,
  UpdateTemplate,
} from './chantier-template.schema';

class ChantierTemplateService extends BaseService<TemplateRow> {
  constructor(db: Knex) {
    super(db, 'chantier_template');
  }

  async findByOrgWithSteps(organizationId: string): Promise<TemplateWithSteps[]> {
    const templates = (await this.db('chantier_template')
      .where({ organization_id: organizationId })
      .orderBy('name', 'asc')) as TemplateRow[];

    if (templates.length === 0) return [];

    const templateIds = templates.map((t) => t.id);
    const steps = (await this.db('chantier_template_step')
      .whereIn('template_id', templateIds)
      .orderBy('position', 'asc')) as TemplateStepRow[];

    const stepIds = steps.map((s) => s.id);
    const substeps =
      stepIds.length > 0
        ? ((await this.db('chantier_template_substep')
            .whereIn('template_step_id', stepIds)
            .orderBy('position', 'asc')) as TemplateSubstepRow[])
        : [];

    const members = (await this.db('chantier_template_member')
      .join('user', 'chantier_template_member.user_id', 'user.id')
      .whereIn('chantier_template_member.template_id', templateIds)
      .select(
        'chantier_template_member.*',
        'user.first_name',
        'user.last_name',
        'user.email',
        'user.role',
      )) as TemplateMemberWithUser[];

    const subBucket = new Map<string, TemplateSubstepRow[]>();
    for (const sub of substeps) {
      const arr = subBucket.get(sub.template_step_id) ?? [];
      arr.push(sub);
      subBucket.set(sub.template_step_id, arr);
    }

    const stepBucket = new Map<string, (TemplateStepRow & { substeps: TemplateSubstepRow[] })[]>();
    for (const s of steps) {
      const arr = stepBucket.get(s.template_id) ?? [];
      arr.push({ ...s, substeps: subBucket.get(s.id) ?? [] });
      stepBucket.set(s.template_id, arr);
    }

    const memberBucket = new Map<string, TemplateMemberWithUser[]>();
    for (const m of members) {
      const arr = memberBucket.get(m.template_id) ?? [];
      arr.push(m);
      memberBucket.set(m.template_id, arr);
    }

    return templates.map((t) => ({
      ...t,
      steps: stepBucket.get(t.id) ?? [],
      members: memberBucket.get(t.id) ?? [],
    }));
  }

  async findByIdWithSteps(id: string): Promise<TemplateWithSteps | undefined> {
    const template = (await this.db('chantier_template').where({ id }).first()) as TemplateRow | undefined;
    if (!template) return undefined;

    const steps = (await this.db('chantier_template_step')
      .where({ template_id: id })
      .orderBy('position', 'asc')) as TemplateStepRow[];

    const stepIds = steps.map((s) => s.id);
    const substeps =
      stepIds.length > 0
        ? ((await this.db('chantier_template_substep')
            .whereIn('template_step_id', stepIds)
            .orderBy('position', 'asc')) as TemplateSubstepRow[])
        : [];

    const members = (await this.db('chantier_template_member')
      .join('user', 'chantier_template_member.user_id', 'user.id')
      .where('chantier_template_member.template_id', id)
      .select(
        'chantier_template_member.*',
        'user.first_name',
        'user.last_name',
        'user.email',
        'user.role',
      )) as TemplateMemberWithUser[];

    const subBucket = new Map<string, TemplateSubstepRow[]>();
    for (const sub of substeps) {
      const arr = subBucket.get(sub.template_step_id) ?? [];
      arr.push(sub);
      subBucket.set(sub.template_step_id, arr);
    }

    return {
      ...template,
      steps: steps.map((s) => ({ ...s, substeps: subBucket.get(s.id) ?? [] })),
      members,
    };
  }

  async createWithSteps(
    organizationId: string,
    createdBy: string,
    data: CreateTemplate,
  ): Promise<TemplateWithSteps> {
    return this.db.transaction(async (trx) => {
      const [template] = await trx('chantier_template')
        .insert({
          organization_id: organizationId,
          created_by: createdBy,
          name: data.name,
          description: data.description ?? null,
          default_status: data.default_status,
        })
        .returning('*');

      for (let i = 0; i < (data.steps ?? []).length; i++) {
        const step = data.steps![i];
        const [stepRow] = await trx('chantier_template_step')
          .insert({ template_id: template.id, name: step.name, position: i })
          .returning('*');
        for (let j = 0; j < (step.substeps ?? []).length; j++) {
          const sub = step.substeps![j];
          await trx('chantier_template_substep').insert({
            template_step_id: stepRow.id,
            name: sub.name,
            position: j,
          });
        }
      }

      await this._writeMembers(trx, template.id, organizationId, data.members ?? []);

      return (await this._loadFull(trx, template.id))!;
    });
  }

  async updateWithSteps(id: string, data: UpdateTemplate): Promise<TemplateWithSteps | undefined> {
    return this.db.transaction(async (trx) => {
      const fields: Record<string, unknown> = { updated_at: trx.fn.now() };
      if (data.name !== undefined) fields.name = data.name;
      if (data.description !== undefined) fields.description = data.description;
      if (data.default_status !== undefined) fields.default_status = data.default_status;

      const updated = await trx('chantier_template').where({ id }).update(fields);
      if (!updated) return undefined;

      // Si les etapes sont fournies, on remplace tout (drop + recreate).
      if (data.steps !== undefined) {
        await trx('chantier_template_step').where({ template_id: id }).del();
        for (let i = 0; i < data.steps.length; i++) {
          const step = data.steps[i];
          const [stepRow] = await trx('chantier_template_step')
            .insert({ template_id: id, name: step.name, position: i })
            .returning('*');
          for (let j = 0; j < (step.substeps ?? []).length; j++) {
            const sub = step.substeps![j];
            await trx('chantier_template_substep').insert({
              template_step_id: stepRow.id,
              name: sub.name,
              position: j,
            });
          }
        }
      }

      // Si les membres sont fournis, on remplace tout.
      if (data.members !== undefined) {
        const tpl = (await trx('chantier_template').where({ id }).first()) as TemplateRow | undefined;
        if (tpl) {
          await trx('chantier_template_member').where({ template_id: id }).del();
          await this._writeMembers(trx, id, tpl.organization_id, data.members);
        }
      }

      return this._loadFull(trx, id);
    });
  }

  /**
   * Insere les membres en filtrant les non-eligibles : meme organisation, role
   * global admin/manager/employee uniquement (pas de client/gestionnaire_reseau dans les modeles).
   */
  private async _writeMembers(
    trx: Knex.Transaction,
    templateId: string,
    organizationId: string,
    members: { user_id: string }[],
  ): Promise<void> {
    if (members.length === 0) return;
    const userIds = members.map((m) => m.user_id);
    const eligible = (await trx('user')
      .whereIn('id', userIds)
      .andWhere({ organization_id: organizationId })
      .whereIn('role', ['admin', 'manager', 'employee'])
      .select('id')) as { id: string }[];
    if (eligible.length === 0) return;
    await trx('chantier_template_member')
      .insert(eligible.map((u) => ({ template_id: templateId, user_id: u.id })))
      .onConflict(['template_id', 'user_id'])
      .ignore();
  }

  private async _loadFull(trx: Knex.Transaction, id: string): Promise<TemplateWithSteps | undefined> {
    const template = (await trx('chantier_template').where({ id }).first()) as TemplateRow | undefined;
    if (!template) return undefined;
    const steps = (await trx('chantier_template_step')
      .where({ template_id: id })
      .orderBy('position', 'asc')) as TemplateStepRow[];
    const stepIds = steps.map((s) => s.id);
    const substeps =
      stepIds.length > 0
        ? ((await trx('chantier_template_substep')
            .whereIn('template_step_id', stepIds)
            .orderBy('position', 'asc')) as TemplateSubstepRow[])
        : [];
    const members = (await trx('chantier_template_member')
      .join('user', 'chantier_template_member.user_id', 'user.id')
      .where('chantier_template_member.template_id', id)
      .select(
        'chantier_template_member.*',
        'user.first_name',
        'user.last_name',
        'user.email',
        'user.role',
      )) as TemplateMemberWithUser[];
    const subBucket = new Map<string, TemplateSubstepRow[]>();
    for (const sub of substeps) {
      const arr = subBucket.get(sub.template_step_id) ?? [];
      arr.push(sub);
      subBucket.set(sub.template_step_id, arr);
    }
    return {
      ...template,
      steps: steps.map((s) => ({ ...s, substeps: subBucket.get(s.id) ?? [] })),
      members,
    };
  }
}

export default ChantierTemplateService;
