import { Knex } from 'knex';
import BaseService, { PaginationOptions, PaginatedResult } from '@/lib/base-service';
import { CommentRow, CommentWithMeta, CommentReplyPreview, CommentReactionSummary, ReactionEmoji } from './comment.schema';

class CommentService extends BaseService<CommentRow> {
  constructor(db: Knex) {
    super(db, 'comment');
  }

  /**
   * Messages d'un chantier avec leur auteur, le message cite s'il y en a un,
   * et les reactions agregees du point de vue de `viewerId`.
   */
  async findByChantier(
    chantierId: string,
    options: PaginationOptions & { stepId?: string | null | 'general'; viewerId?: string } = {},
  ): Promise<PaginatedResult<CommentWithMeta>> {
    const { page = 1, limit = 20, orderBy = 'created_at', order = 'desc', stepId, viewerId } = options;
    const offset = (page - 1) * limit;

    const baseQuery = this.db(this.table)
      .join('user', 'comment.author_id', 'user.id')
      .where('comment.chantier_id', chantierId);

    if (stepId === 'general') {
      baseQuery.whereNull('comment.step_id');
    } else if (typeof stepId === 'string') {
      baseQuery.where('comment.step_id', stepId);
    }

    const [items, [{ count }]] = await Promise.all([
      baseQuery
        .clone()
        .select('comment.*', 'user.first_name', 'user.last_name', 'user.avatar_url')
        .orderBy(`comment.${orderBy}`, order)
        .limit(limit)
        .offset(offset) as Promise<(CommentRow & { first_name: string; last_name: string; avatar_url?: string })[]>,
      baseQuery.clone().count('* as count') as Promise<{ count: string }[]>,
    ]);

    const [replies, reactions] = await Promise.all([
      this.repliesFor(items.map((c) => c.reply_to_id).filter((id): id is string => !!id)),
      this.reactionsFor(items.map((c) => c.id), viewerId),
    ]);

    return {
      data: items.map((c) => ({
        ...c,
        reply_to: (c.reply_to_id && replies.get(c.reply_to_id)) || null,
        reactions: reactions.get(c.id) ?? [],
      })),
      meta: { total: parseInt(count, 10), page, limit, totalPages: Math.ceil(parseInt(count, 10) / limit) },
    };
  }

  /** Les messages cites, en une requete. */
  private async repliesFor(ids: string[]): Promise<Map<string, CommentReplyPreview>> {
    const map = new Map<string, CommentReplyPreview>();
    if (ids.length === 0) return map;
    const rows = (await this.db(this.table)
      .join('user', 'comment.author_id', 'user.id')
      .whereIn('comment.id', [...new Set(ids)])
      .select('comment.id', 'comment.content', 'comment.author_id', 'user.first_name', 'user.last_name')) as CommentReplyPreview[];
    for (const r of rows) map.set(r.id, r);
    return map;
  }

  /** Reactions agregees par message : nombre par emoji, et si le lecteur a reagi. */
  async reactionsFor(commentIds: string[], viewerId?: string): Promise<Map<string, CommentReactionSummary[]>> {
    const map = new Map<string, CommentReactionSummary[]>();
    if (commentIds.length === 0) return map;
    const rows = (await this.db('comment_reaction')
      .whereIn('comment_id', commentIds)
      .select('comment_id', 'emoji')
      .count('* as count')
      .select(this.db.raw('bool_or(user_id = ?) as mine', [viewerId ?? '00000000-0000-0000-0000-000000000000']))
      .groupBy('comment_id', 'emoji')
      .orderBy('emoji')) as unknown as { comment_id: string; emoji: ReactionEmoji; count: string; mine: boolean }[];
    for (const r of rows) {
      const arr = map.get(r.comment_id) ?? [];
      arr.push({ emoji: r.emoji, count: parseInt(r.count, 10), mine: r.mine });
      map.set(r.comment_id, arr);
    }
    return map;
  }

  /**
   * Interrupteur : ajoute la reaction si elle n'y est pas, la retire sinon.
   * Renvoie les reactions du message apres coup.
   */
  async toggleReaction(commentId: string, userId: string, emoji: ReactionEmoji): Promise<CommentReactionSummary[]> {
    const existing = await this.db('comment_reaction').where({ comment_id: commentId, user_id: userId, emoji }).first();
    if (existing) {
      await this.db('comment_reaction').where({ id: existing.id }).del();
    } else {
      await this.db('comment_reaction')
        .insert({ comment_id: commentId, user_id: userId, emoji })
        .onConflict(['comment_id', 'user_id', 'emoji'])
        .ignore();
    }
    return (await this.reactionsFor([commentId], userId)).get(commentId) ?? [];
  }
}

export default CommentService;
