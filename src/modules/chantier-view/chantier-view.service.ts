import { Knex } from 'knex';
import { Tab, UnreadCounts } from './chantier-view.schema';
import { getUserPermissions } from '@/lib/permissions';
import { getActiveMembership } from '@/lib/active-membership';

class ChantierViewService {
  constructor(private db: Knex) {}

  /** Upsert : marque un onglet comme vu maintenant. */
  async markViewed(userId: string, chantierId: string, tab: Tab): Promise<void> {
    await this.db('chantier_view')
      .insert({
        user_id: userId,
        chantier_id: chantierId,
        tab,
        last_viewed_at: this.db.fn.now(),
        updated_at: this.db.fn.now(),
      })
      .onConflict(['user_id', 'chantier_id', 'tab'])
      .merge({
        last_viewed_at: this.db.fn.now(),
        updated_at: this.db.fn.now(),
      });
  }

  /**
   * Compte le nombre d'items non lus par onglet pour un chantier donne.
   * "Non lu" = item.created_at > last_viewed_at (ou tous les items si jamais consulte).
   * Filtres appliques :
   *  - exclut les items dont l'auteur est l'utilisateur lui-meme
   *  - retourne 0 pour un onglet ou le user n'a pas la permission de voir
   *    (sinon on affiche une pastille pour du contenu invisible)
   *  - gestionnaire_reseau : compte uniquement les documents de type DICT
   *    (le filtrage cote API restreint deja l'acces a ces docs uniquement).
   */
  async unreadCounts(userId: string, chantierId: string): Promise<UnreadCounts> {
    const [perms, membership, views] = await Promise.all([
      getUserPermissions(this.db, userId, chantierId),
      getActiveMembership(this.db, userId),
      this.db('chantier_view')
        .where({ user_id: userId, chantier_id: chantierId })
        .select('tab', 'last_viewed_at') as Promise<{ tab: Tab; last_viewed_at: string }[]>,
    ]);
    const seen = new Map<Tab, string>();
    for (const v of views) seen.set(v.tab, v.last_viewed_at);

    const lastSeen = (tab: Tab) => seen.get(tab) ?? '1970-01-01';

    const isGestionnaireReseau = membership?.role === 'gestionnaire_reseau';

    // Discussions : la table `comment` contient les messages generaux (step_id IS NULL)
    // et les messages d'etape (step_id IS NOT NULL). On gate chaque categorie par sa perm.
    let commentsCount = 0;
    if (perms.view_comments || perms.view_steps) {
      const q = this.db('comment')
        .where({ chantier_id: chantierId })
        .where('created_at', '>', lastSeen('comments'))
        .whereNot('author_id', userId);
      if (perms.view_comments && !perms.view_steps) q.whereNull('step_id');
      else if (!perms.view_comments && perms.view_steps) q.whereNotNull('step_id');
      const [row] = (await q.count('* as count')) as { count: string }[];
      commentsCount = parseInt(row.count, 10);
    }

    let photosCount = 0;
    if (perms.view_photos) {
      const [row] = (await this.db('photo')
        .where({ chantier_id: chantierId })
        .where('created_at', '>', lastSeen('photos'))
        .whereNot('uploaded_by', userId)
        .count('* as count')) as { count: string }[];
      photosCount = parseInt(row.count, 10);
    }

    // Documents : gestionnaire_reseau a toujours acces aux DICT meme sans can_view_documents
    // (c'est tout l'interet de son role).
    let documentsCount = 0;
    if (perms.view_documents || isGestionnaireReseau) {
      const q = this.db('document')
        .where({ chantier_id: chantierId })
        .where('created_at', '>', lastSeen('documents'))
        .whereNot('uploaded_by', userId);
      if (isGestionnaireReseau) q.where('type', 'dict');
      const [row] = (await q.count('* as count')) as { count: string }[];
      documentsCount = parseInt(row.count, 10);
    }

    // Urgences : visibles a tous les membres du chantier sans condition (cf. canCreateEmergency
    // dans chantier-emergency : la lecture n'est gatee que sur isChantierMember).
    // On compte les nouvelles urgences ET les commentaires sur urgences (qui appartiennent
    // au meme onglet UI), pour que la pastille s'incremente quand quelqu'un repond a une
    // urgence existante.
    const [emergenciesRow, emergencyCommentsRow] = await Promise.all([
      this.db('chantier_emergency')
        .where({ chantier_id: chantierId })
        .where('created_at', '>', lastSeen('emergencies'))
        .whereNot('created_by', userId)
        .count('* as count') as Promise<{ count: string }[]>,
      this.db('emergency_comment')
        .join('chantier_emergency', 'emergency_comment.emergency_id', 'chantier_emergency.id')
        .where('chantier_emergency.chantier_id', chantierId)
        .where('emergency_comment.created_at', '>', lastSeen('emergencies'))
        .whereNot('emergency_comment.author_id', userId)
        .count('* as count') as Promise<{ count: string }[]>,
    ]);
    const emergenciesCount =
      parseInt(emergenciesRow[0].count, 10) + parseInt(emergencyCommentsRow[0].count, 10);

    return {
      comments: commentsCount,
      photos: photosCount,
      documents: documentsCount,
      emergencies: emergenciesCount,
    };
  }

  /**
   * Renvoie le total des items non-lus pour chaque chantier visible par le user,
   * agrege aussi par organisation. Sert pour les pastilles sur les cartes
   * de chantier (liste) et sur les rows d'organisations (profil).
   *
   * "Chantier visible" = chantier ou le user est :
   *  - admin de l'organisation
   *  - createur du chantier
   *  - membre du chantier
   * (les organisations active du user n'est pas filtree ici — on retourne tout pour
   *  pouvoir afficher des badges meme sur les orgs non actives)
   */
  async unreadSummary(userId: string): Promise<{
    by_chantier: Record<string, number>;
    by_organization: Record<string, number>;
  }> {
    // 1. Trouver tous les chantier_id visibles par le user, avec leur org.
    const visible = (await this.db('chantier')
      .leftJoin('chantier_member', function () {
        this.on('chantier_member.chantier_id', '=', 'chantier.id').andOnVal(
          'chantier_member.user_id',
          '=',
          userId,
        );
      })
      .leftJoin('organization_member', function () {
        this.on('organization_member.organization_id', '=', 'chantier.organization_id').andOnVal(
          'organization_member.user_id',
          '=',
          userId,
        );
      })
      .where(function () {
        this.where('chantier.created_by', userId)
          .orWhereNotNull('chantier_member.id')
          .orWhere('organization_member.role', 'admin');
      })
      .whereNull('chantier.archived_at')
      .select('chantier.id as id', 'chantier.organization_id as organization_id')
      .groupBy('chantier.id', 'chantier.organization_id')) as { id: string; organization_id: string }[];

    if (visible.length === 0) return { by_chantier: {}, by_organization: {} };

    // 2. Calculer les unread counts en parallele.
    const counts = await Promise.all(
      visible.map(async (c) => {
        const u = await this.unreadCounts(userId, c.id);
        return {
          chantier_id: c.id,
          organization_id: c.organization_id,
          total: u.comments + u.photos + u.documents + u.emergencies,
        };
      }),
    );

    const by_chantier: Record<string, number> = {};
    const by_organization: Record<string, number> = {};
    for (const c of counts) {
      if (c.total > 0) by_chantier[c.chantier_id] = c.total;
      by_organization[c.organization_id] = (by_organization[c.organization_id] ?? 0) + c.total;
    }
    return { by_chantier, by_organization };
  }
}

export default ChantierViewService;
