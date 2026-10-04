import { z } from 'zod';

/**
 * Les reactions possibles. Une liste fermee plutot qu'un emoji libre : les
 * compteurs se regroupent par emoji, et sept suffisent a dire ce qu'on a a
 * dire sur un chantier. Les clients affichent cette meme rangee.
 */
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export const createCommentSchema = z.object({
  chantier_id: z.string().uuid(),
  step_id: z.string().uuid().nullable().optional(),
  content: z.string().min(1).max(5000),
  /** Message auquel on repond : il doit appartenir au meme chantier. */
  reply_to_id: z.string().uuid().nullable().optional(),
});

export const updateCommentSchema = z.object({
  content: z.string().min(1).max(5000).optional(),
});

export const reactionSchema = z.object({
  emoji: z.enum(REACTION_EMOJIS),
});

export type CreateComment = z.infer<typeof createCommentSchema>;
export type UpdateComment = z.infer<typeof updateCommentSchema>;

export type CommentRow = {
  id: string;
  chantier_id: string;
  step_id: string | null;
  author_id: string;
  content: string;
  reply_to_id: string | null;
  created_at: string;
  updated_at: string;
};

/** Le message cite, tel qu'affiche au-dessus d'une reponse. */
export type CommentReplyPreview = {
  id: string;
  content: string;
  author_id: string;
  first_name: string;
  last_name: string;
};

/** Une reaction agregee : combien de personnes, et si le lecteur en est. */
export type CommentReactionSummary = {
  emoji: ReactionEmoji;
  count: number;
  mine: boolean;
};

export type CommentWithMeta = CommentRow & {
  first_name: string;
  last_name: string;
  avatar_url?: string;
  reply_to: CommentReplyPreview | null;
  reactions: CommentReactionSummary[];
};
