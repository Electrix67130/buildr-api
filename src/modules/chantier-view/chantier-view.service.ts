import { Knex } from 'knex';
import { Tab, UnreadCounts } from './chantier-view.schema';
import { getUserPermissions } from '@/lib/permissions';
import { getActiveMembership } from '@/lib/active-membership';

class ChantierViewService {
  constructor(private db: Knex) {}

  /** Upsert : marque un item précis (étape, urgence) comme vu maintenant. */
  async markItemViewed(userId: string, itemType: 'step' | 'emergency', itemId: string): Promise<void> {
    await this.db('chantier_item_view')
      .insert({
        user_id: userId,
        item_type: itemType,
        item_id: itemId,
        last_viewed_at: this.db.fn.now(),
      })
      .onConflict(['user_id', 'item_type', 'item_id'])
      .merge({ last_viewed_at: this.db.fn.now() });
  }

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
    const [perms, membership, views, itemViews] = await Promise.all([
      getUserPermissions(this.db, userId, chantierId),
      getActiveMembership(this.db, userId),
      this.db('chantier_view')
        .where({ user_id: userId, chantier_id: chantierId })
        .select('tab', 'last_viewed_at') as Promise<{ tab: Tab; last_viewed_at: string }[]>,
      this.db('chantier_item_view')
        .where({ user_id: userId })
        .select('item_type', 'item_id', 'last_viewed_at') as Promise<
        { item_type: string; item_id: string; last_viewed_at: string }[]
      >,
    ]);
    const seen = new Map<Tab, string>();
    for (const v of views) seen.set(v.tab, v.last_viewed_at);
    const lastSeen = (tab: Tab) => seen.get(tab) ?? '1970-01-01';

    // Map: item_id (step ou emergency) -> last_viewed_at quand le user a ouvert CET item.
    // Permet de masquer la pastille d'une étape spécifique quand on l'ouvre, sans toucher
    // au last_viewed_at global de comments_steps.
    const itemSeen = new Map<string, string>();
    for (const v of itemViews) itemSeen.set(`${v.item_type}:${v.item_id}`, v.last_viewed_at);

    const isGestionnaireReseau = membership?.role === 'gestionnaire_reseau';

    // Discussions : la table `comment` contient les messages generaux (step_id IS NULL)
    // et les messages d'etape (step_id IS NOT NULL). Chaque sous-onglet est compte
    // independamment pour qu'on puisse afficher une pastille par sous-onglet cote mobile.
    let commentsCount = 0;
    if (perms.view_comments) {
      const [row] = (await this.db('comment')
        .where({ chantier_id: chantierId })
        .whereNull('step_id')
        .where('created_at', '>', lastSeen('comments'))
        .whereNot('author_id', userId)
        .count('* as count')) as { count: string }[];
      commentsCount = parseInt(row.count, 10);
    }

    let commentsStepsCount = 0;
    let unreadStepIds: string[] = [];
    if (perms.view_steps) {
      // On récupère TOUS les commentaires d'étape postés par d'autres après le
      // last_viewed_at global. Puis on filtre côté JS pour exclure ceux qui sont
      // ANTÉRIEURS à la dernière ouverture de leur step (chantier_item_view).
      // Le badge sur une étape disparaît donc quand on ouvre CETTE étape précise.
      const rows = (await this.db('comment')
        .where({ chantier_id: chantierId })
        .whereNotNull('step_id')
        .where('created_at', '>', lastSeen('comments_steps'))
        .whereNot('author_id', userId)
        .select('step_id', 'created_at')) as { step_id: string; created_at: string }[];

      const countByStep = new Map<string, number>();
      for (const r of rows) {
        const stepLastSeen = itemSeen.get(`step:${r.step_id}`);
        if (stepLastSeen && new Date(r.created_at) <= new Date(stepLastSeen)) continue;
        countByStep.set(r.step_id, (countByStep.get(r.step_id) ?? 0) + 1);
      }
      unreadStepIds = [...countByStep.keys()];
      commentsStepsCount = [...countByStep.values()].reduce((s, n) => s + n, 0);
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
    // Decoupage par sous-onglet :
    //   - `emergencies`        = incidents externes uniquement (type=emergency)
    //   - `emergencies_claim`  = reclamations (type=claim)
    // On compte aussi les commentaires sur urgences, en les attachant au sous-onglet
    // de leur urgence-parent.
    // Le "type" emergency/claim n'est PAS stocké en colonne : il se déduit du rôle
    // du créateur sur ce chantier (member_role === 'client' → 'claim', sinon 'emergency').
    // On reproduit cette logique en SQL via un LEFT JOIN sur chantier_member, puis
    // on filtre par type.
    const buildEmergencyAggregate = async (type: 'emergency' | 'claim', tabKey: Tab) => {
      const since = lastSeen(tabKey);
      const typeFilter =
        type === 'claim'
          ? "chantier_member.role = 'client'"
          : "(chantier_member.role IS NULL OR chantier_member.role != 'client')";

      const [newRows, commentRows] = await Promise.all([
        this.db('chantier_emergency')
          .leftJoin('chantier_member', function () {
            this.on('chantier_member.user_id', '=', 'chantier_emergency.created_by').andOn(
              'chantier_member.chantier_id',
              '=',
              'chantier_emergency.chantier_id',
            );
          })
          .where('chantier_emergency.chantier_id', chantierId)
          .whereRaw(typeFilter)
          .where('chantier_emergency.created_at', '>', since)
          .whereNot('chantier_emergency.created_by', userId)
          .select('chantier_emergency.id', 'chantier_emergency.created_at') as Promise<
          { id: string; created_at: string }[]
        >,
        this.db('emergency_comment')
          .join('chantier_emergency', 'emergency_comment.emergency_id', 'chantier_emergency.id')
          .leftJoin('chantier_member', function () {
            this.on('chantier_member.user_id', '=', 'chantier_emergency.created_by').andOn(
              'chantier_member.chantier_id',
              '=',
              'chantier_emergency.chantier_id',
            );
          })
          .where('chantier_emergency.chantier_id', chantierId)
          .whereRaw(typeFilter)
          .where('emergency_comment.created_at', '>', since)
          .whereNot('emergency_comment.author_id', userId)
          .select('chantier_emergency.id as emergency_id', 'emergency_comment.created_at') as Promise<
          { emergency_id: string; created_at: string }[]
        >,
      ]);

      // Filtre côté JS : si l'item a été ouvert via chantier_item_view APRÈS la création
      // du contenu non-lu, on l'exclut. Le badge disparaît quand on ouvre l'urgence.
      const ids = new Set<string>();
      let totalCount = 0;
      for (const r of newRows) {
        const seenAt = itemSeen.get(`emergency:${r.id}`);
        if (seenAt && new Date(r.created_at) <= new Date(seenAt)) continue;
        ids.add(r.id);
        totalCount += 1;
      }
      for (const r of commentRows) {
        const seenAt = itemSeen.get(`emergency:${r.emergency_id}`);
        if (seenAt && new Date(r.created_at) <= new Date(seenAt)) continue;
        ids.add(r.emergency_id);
        totalCount += 1;
      }
      return { count: totalCount, ids: [...ids] };
    };
    const [extAgg, claimAgg] = await Promise.all([
      buildEmergencyAggregate('emergency', 'emergencies'),
      buildEmergencyAggregate('claim', 'emergencies_claim'),
    ]);

    return {
      comments: commentsCount,
      comments_steps: commentsStepsCount,
      photos: photosCount,
      documents: documentsCount,
      emergencies: extAgg.count,
      emergencies_claim: claimAgg.count,
      unread_step_ids: unreadStepIds,
      unread_emergency_ids: [...extAgg.ids, ...claimAgg.ids],
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
          total:
            u.comments +
            u.comments_steps +
            u.photos +
            u.documents +
            u.emergencies +
            u.emergencies_claim,
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
