import { Knex } from 'knex';
import BaseService, { PaginatedResult } from '@/lib/base-service';
import { isChantierParticipant } from '@/lib/permissions';
import {
  CreateReport,
  ListReports,
  ReportRow,
  ReportWithContext,
  ResolveReport,
} from './report.schema';

/** Ce qu'on a trouve derriere la cible : ou elle vit, qui en est responsable. */
type ResolvedTarget = {
  organization_id: string;
  chantier_id: string | null;
  target_user_id: string | null;
  excerpt: string | null;
};

class ReportService extends BaseService<ReportRow> {
  constructor(db: Knex) {
    super(db, 'report');
  }

  /**
   * Retrouve l'organisation, le chantier et la personne responsable d'une
   * cible, et verifie que le rapporteur a bien acces a ce qu'il signale.
   * Renvoie `null` si la cible n'existe pas ou n'est pas visible de lui : on
   * ne confirme pas l'existence de ce qu'on n'a pas le droit de voir.
   */
  async resolveTarget(data: CreateReport, reporterId: string): Promise<ResolvedTarget | null> {
    if (data.target_type === 'comment') {
      const row = await this.db('comment')
        .join('chantier', 'chantier.id', 'comment.chantier_id')
        .where('comment.id', data.target_id)
        .select('comment.chantier_id', 'comment.author_id', 'comment.content', 'chantier.organization_id')
        .first();
      if (!row || !(await isChantierParticipant(this.db, reporterId, row.chantier_id))) return null;
      return {
        organization_id: row.organization_id,
        chantier_id: row.chantier_id,
        target_user_id: row.author_id,
        excerpt: String(row.content).slice(0, 300),
      };
    }
    if (data.target_type === 'emergency_comment') {
      const row = await this.db('emergency_comment')
        .join('chantier_emergency', 'chantier_emergency.id', 'emergency_comment.emergency_id')
        .join('chantier', 'chantier.id', 'chantier_emergency.chantier_id')
        .where('emergency_comment.id', data.target_id)
        .select('chantier.id as chantier_id', 'chantier.organization_id', 'emergency_comment.author_id', 'emergency_comment.content')
        .first();
      if (!row || !(await isChantierParticipant(this.db, reporterId, row.chantier_id))) return null;
      return {
        organization_id: row.organization_id,
        chantier_id: row.chantier_id,
        target_user_id: row.author_id,
        excerpt: String(row.content).slice(0, 300),
      };
    }
    if (data.target_type === 'photo') {
      const row = await this.db('photo')
        .join('chantier', 'chantier.id', 'photo.chantier_id')
        .where('photo.id', data.target_id)
        .select('photo.chantier_id', 'photo.uploaded_by', 'photo.url', 'photo.caption', 'chantier.organization_id')
        .first();
      if (!row || !(await isChantierParticipant(this.db, reporterId, row.chantier_id))) return null;
      return {
        organization_id: row.organization_id,
        chantier_id: row.chantier_id,
        target_user_id: row.uploaded_by,
        excerpt: row.caption ? String(row.caption).slice(0, 300) : null,
      };
    }
    // user : il faut partager une organisation avec la personne visee. On
    // retient celle du rapporteur ou la personne est membre, en commencant par
    // son organisation active.
    const reporter = await this.db('user').where({ id: reporterId }).select('active_organization_id').first();
    const shared = (await this.db('organization_member as mine')
      .join('organization_member as theirs', 'theirs.organization_id', 'mine.organization_id')
      .where('mine.user_id', reporterId)
      .where('theirs.user_id', data.target_id)
      .select('mine.organization_id')) as { organization_id: string }[];
    if (shared.length === 0) return null;
    const organization_id =
      shared.find((s) => s.organization_id === reporter?.active_organization_id)?.organization_id ?? shared[0].organization_id;
    const target = await this.db('user').where({ id: data.target_id }).select('first_name', 'last_name').first();
    return {
      organization_id,
      chantier_id: null,
      target_user_id: data.target_id,
      excerpt: target ? `${target.first_name} ${target.last_name}` : null,
    };
  }

  /** La personne visee est-elle administratrice de cette organisation ? */
  async isOrgAdmin(userId: string | null, organizationId: string): Promise<boolean> {
    if (!userId) return false;
    const m = await this.db('organization_member').where({ user_id: userId, organization_id: organizationId }).first();
    return m?.role === 'admin';
  }

  /** Un signalement en attente du meme rapporteur sur la meme cible, s'il existe. */
  async findPendingDuplicate(reporterId: string, data: CreateReport): Promise<ReportRow | undefined> {
    return (await this.db(this.table)
      .where({ reporter_id: reporterId, target_type: data.target_type, target_id: data.target_id, status: 'pending' })
      .first()) as ReportRow | undefined;
  }

  /** Les administrateurs de l'organisation, hors la personne visee et le rapporteur. */
  async adminsToNotify(organizationId: string, exclude: (string | null)[]): Promise<string[]> {
    const rows = (await this.db('organization_member')
      .where({ organization_id: organizationId, role: 'admin' })
      .whereNotIn('user_id', exclude.filter((x): x is string => !!x))
      .select('user_id')) as { user_id: string }[];
    return rows.map((r) => r.user_id);
  }

  async superAdminIds(): Promise<string[]> {
    const rows = (await this.db('user').where({ is_super_admin: true, is_active: true }).select('id')) as { id: string }[];
    return rows.map((r) => r.id);
  }

  /**
   * Signalements d'une organisation pour celui qui les traite. Il ne voit
   * jamais ceux qui le visent : on ne se juge pas soi-meme.
   */
  async listForOrganization(
    organizationId: string,
    viewerId: string,
    filters: ListReports,
  ): Promise<PaginatedResult<ReportWithContext> & { counts: { pending: number } }> {
    const base = this.db(this.table)
      .where('report.organization_id', organizationId)
      .where((qb) => qb.whereNull('report.target_user_id').orWhereNot('report.target_user_id', viewerId));
    return this.paginate(base, filters);
  }

  /** Tous les signalements, pour la console. */
  async listAll(filters: ListReports & { escalated?: boolean; organization_id?: string }): Promise<PaginatedResult<ReportWithContext> & { counts: { pending: number } }> {
    const base = this.db(this.table).modify((qb) => {
      if (filters.escalated) qb.where('report.escalated', true);
      if (filters.organization_id) qb.where('report.organization_id', filters.organization_id);
    });
    return this.paginate(base, filters);
  }

  private async paginate(base: Knex.QueryBuilder, filters: ListReports): Promise<PaginatedResult<ReportWithContext> & { counts: { pending: number } }> {
    const { page, limit, status, chantier_id } = filters;
    const filtered = base.clone().modify((qb) => {
      if (status) qb.where('report.status', status);
      if (chantier_id) qb.where('report.chantier_id', chantier_id);
    });
    const [rows, [{ count }], [{ pending }]] = await Promise.all([
      filtered
        .clone()
        .join('user as reporter', 'reporter.id', 'report.reporter_id')
        .leftJoin('user as target', 'target.id', 'report.target_user_id')
        .leftJoin('chantier', 'chantier.id', 'report.chantier_id')
        .join('organization', 'organization.id', 'report.organization_id')
        .select(
          'report.*',
          'reporter.first_name as reporter_first_name',
          'reporter.last_name as reporter_last_name',
          'target.first_name as target_first_name',
          'target.last_name as target_last_name',
          'chantier.name as chantier_name',
          'organization.name as organization_name',
        )
        .orderBy('report.created_at', 'desc')
        .limit(limit)
        .offset((page - 1) * limit) as Promise<Omit<ReportWithContext, 'target_exists'>[]>,
      filtered.clone().count('* as count') as Promise<{ count: string }[]>,
      base.clone().where('report.status', 'pending').count('* as pending') as Promise<{ pending: string }[]>,
    ]);

    const exists = await this.targetsStillExist(rows);
    return {
      data: rows.map((r) => ({ ...r, target_exists: exists.get(r.id) ?? true })),
      meta: { total: parseInt(count, 10), page, limit, totalPages: Math.ceil(parseInt(count, 10) / limit) },
      counts: { pending: parseInt(pending, 10) },
    };
  }

  /** Un message ou une photo signale a-t-il deja ete supprime ? */
  private async targetsStillExist(rows: { id: string; target_type: string; target_id: string }[]): Promise<Map<string, boolean>> {
    const map = new Map<string, boolean>();
    for (const type of ['comment', 'emergency_comment', 'photo'] as const) {
      const ids = rows.filter((r) => r.target_type === type).map((r) => r.target_id);
      if (ids.length === 0) continue;
      const found = new Set(((await this.db(type).whereIn('id', ids).select('id')) as { id: string }[]).map((r) => r.id));
      for (const r of rows) if (r.target_type === type) map.set(r.id, found.has(r.target_id));
    }
    return map;
  }

  async resolve(id: string, data: ResolveReport, resolverId: string): Promise<ReportRow | undefined> {
    const [row] = await this.db(this.table)
      .where({ id })
      .update({
        status: data.status,
        resolution_note: data.resolution_note ?? null,
        resolved_by: resolverId,
        resolved_at: this.db.fn.now(),
        updated_at: this.db.fn.now(),
      })
      .returning('*');
    return row as ReportRow | undefined;
  }
}

export default ReportService;
