import { Knex } from 'knex';
import { extractMentionIds } from './mentions';
import { getActorAndChantierNames } from './push-helpers';
import { commentPush, mentionPush } from './push-i18n';
import { sendMentionPush, sendPushToChantier, type ChantierAccess } from './push-notifications';

type Log = { error: (...args: unknown[]) => void; info?: (...args: unknown[]) => void };

/**
 * Notifications d'un message ecrit ou modifie, dans une discussion de chantier
 * ou le fil d'une urgence.
 *
 * Les personnes mentionnees recoivent la notification de mention, et pas en
 * plus la notification ordinaire : un seul message, une seule alerte. Une
 * modification ne previent que ceux qui viennent d'etre mentionnes — corriger
 * une faute ne doit pas faire sonner tout le chantier une seconde fois.
 */
export async function notifyMessage(
  db: Knex,
  log: Log,
  message: {
    chantierId: string;
    authorId: string;
    commentId: string;
    content: string;
    /** Le texte avant modification ; absent pour un nouveau message. */
    previousContent?: string;
    stepId?: string | null;
    emergencyId?: string;
  },
): Promise<void> {
  const access: ChantierAccess = message.emergencyId ? 'participant' : 'view_comments';
  const already = new Set(message.previousContent ? extractMentionIds(message.previousContent) : []);
  const mentioned = extractMentionIds(message.content).filter((id) => !already.has(id));
  const isEdit = message.previousContent !== undefined;
  if (isEdit && mentioned.length === 0) return;

  const { actorName, chantierName } = await getActorAndChantierNames(db, message.authorId, message.chantierId);
  const notified = await sendMentionPush(
    db,
    message.chantierId,
    message.authorId,
    mentioned,
    mentionPush({
      chantierName,
      actorName,
      content: message.content,
      chantierId: message.chantierId,
      commentId: message.commentId,
      stepId: message.stepId,
      emergencyId: message.emergencyId,
    }),
    log,
    access,
  );
  if (isEdit) return;

  await sendPushToChantier(
    db,
    message.chantierId,
    message.authorId,
    commentPush({
      chantierName,
      actorName,
      content: message.content,
      chantierId: message.chantierId,
      onEmergency: !!message.emergencyId,
      emergencyId: message.emergencyId,
    }),
    log,
    { access, alsoExclude: notified },
  );
}
