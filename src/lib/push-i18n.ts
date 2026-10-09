import { MAIL_LOCALES, isMailLocale, type MailLocale } from './mail-i18n';
import { truncate } from './push-helpers';
import { mentionsToText } from './mentions';
import type { PushPayload } from './push-notifications';

/**
 * Textes des notifications push, et construction des messages.
 *
 * Tout ce que le produit envoie en notification se compose ici. C'est
 * volontaire : tant que les textes vivaient dans les modules, chaque nouvelle
 * notification etait ecrite en francais a cote des precedentes, sans que
 * personne ne s'en apercoive.
 *
 * La liste des langues est celle de `mail-i18n` : ajouter une langue au produit
 * ne doit se faire qu'a un seul endroit. Le nom `MAIL_LOCALES` est un heritage
 * de son premier usage — la liste, elle, n'a rien de specifique aux e-mails.
 */
export const PUSH_LOCALES = MAIL_LOCALES;
export type PushLocale = MailLocale;
export const isPushLocale = isMailLocale;

interface PushStrings {
  /** Ajout a un chantier. */
  memberAdded: (actor: string) => string;
  /** Validation d'une sous-etape, puis d'une etape. */
  substepValidated: (actor: string, name: string) => string;
  stepValidated: (actor: string, name: string) => string;
  documentAdded: (actor: string, name: string) => string;
  photoAdded: (actor: string) => string;
  /** Urgences et reclamations : un mot pour le titre, une phrase pour le corps. */
  emergencyTitle: string;
  claimTitle: string;
  emergencyReported: (actor: string) => string;
  claimReported: (actor: string) => string;
  /** Reponse du support a un signalement. */
  feedbackReply: string;
  /** Un membre a signale un contenu ou une personne. */
  reportTitle: string;
  reportBody: (where: string) => string;
  /** Quelqu'un vous a mentionne dans un message. */
  mentioned: (actor: string) => string;
}

export const PUSH: Record<PushLocale, PushStrings> = {
  fr: {
    memberAdded: (a) => `${a} vous a ajouté à ce chantier`,
    substepValidated: (a, n) => `${a} a validé : ${n}`,
    stepValidated: (a, n) => `${a} a validé l'étape : ${n}`,
    documentAdded: (a, n) => `${a} a ajouté un document : ${n}`,
    photoAdded: (a) => `${a} a ajouté une photo`,
    emergencyTitle: 'Urgence',
    claimTitle: 'Réclamation',
    emergencyReported: (a) => `${a} a signalé une urgence`,
    claimReported: (a) => `${a} a fait une réclamation`,
    feedbackReply: 'Réponse à votre signalement',
    reportTitle: 'Signalement',
    reportBody: (where) => `Un contenu ou un membre a été signalé sur ${where}. À examiner.`,
    mentioned: (a) => `${a} vous a mentionné`,
  },
  en: {
    memberAdded: (a) => `${a} added you to this site`,
    substepValidated: (a, n) => `${a} validated: ${n}`,
    stepValidated: (a, n) => `${a} validated the step: ${n}`,
    documentAdded: (a, n) => `${a} added a document: ${n}`,
    photoAdded: (a) => `${a} added a photo`,
    emergencyTitle: 'Emergency',
    claimTitle: 'Claim',
    emergencyReported: (a) => `${a} reported an emergency`,
    claimReported: (a) => `${a} filed a claim`,
    feedbackReply: 'Reply to your report',
    reportTitle: 'Report',
    reportBody: (where) => `Content or a member has been reported on ${where}. Please review.`,
    mentioned: (a) => `${a} mentioned you`,
  },
  de: {
    memberAdded: (a) => `${a} hat Sie zu dieser Baustelle hinzugefügt`,
    substepValidated: (a, n) => `${a} hat abgeschlossen: ${n}`,
    stepValidated: (a, n) => `${a} hat den Schritt abgeschlossen: ${n}`,
    documentAdded: (a, n) => `${a} hat ein Dokument hinzugefügt: ${n}`,
    photoAdded: (a) => `${a} hat ein Foto hinzugefügt`,
    emergencyTitle: 'Notfall',
    claimTitle: 'Reklamation',
    emergencyReported: (a) => `${a} hat einen Notfall gemeldet`,
    claimReported: (a) => `${a} hat eine Reklamation eingereicht`,
    feedbackReply: 'Antwort auf Ihre Meldung',
    reportTitle: 'Meldung',
    reportBody: (where) => `Auf ${where} wurde ein Inhalt oder ein Mitglied gemeldet. Bitte prüfen.`,
    mentioned: (a) => `${a} hat Sie erwähnt`,
  },
  es: {
    memberAdded: (a) => `${a} le ha añadido a esta obra`,
    substepValidated: (a, n) => `${a} ha validado: ${n}`,
    stepValidated: (a, n) => `${a} ha validado la etapa: ${n}`,
    documentAdded: (a, n) => `${a} ha añadido un documento: ${n}`,
    photoAdded: (a) => `${a} ha añadido una foto`,
    emergencyTitle: 'Urgencia',
    claimTitle: 'Reclamación',
    emergencyReported: (a) => `${a} ha señalado una urgencia`,
    claimReported: (a) => `${a} ha presentado una reclamación`,
    feedbackReply: 'Respuesta a su incidencia',
    reportTitle: 'Denuncia',
    reportBody: (where) => `Se ha denunciado un contenido o un miembro en ${where}. Por favor, revíselo.`,
    mentioned: (a) => `${a} le ha mencionado`,
  },
  it: {
    memberAdded: (a) => `${a} l'ha aggiunta a questo cantiere`,
    substepValidated: (a, n) => `${a} ha convalidato: ${n}`,
    stepValidated: (a, n) => `${a} ha convalidato la fase: ${n}`,
    documentAdded: (a, n) => `${a} ha aggiunto un documento: ${n}`,
    photoAdded: (a) => `${a} ha aggiunto una foto`,
    emergencyTitle: 'Emergenza',
    claimTitle: 'Reclamo',
    emergencyReported: (a) => `${a} ha segnalato un'emergenza`,
    claimReported: (a) => `${a} ha presentato un reclamo`,
    feedbackReply: 'Risposta alla sua segnalazione',
    reportTitle: 'Segnalazione',
    reportBody: (where) => `Un contenuto o un membro è stato segnalato su ${where}. Da esaminare.`,
    mentioned: (a) => `${a} l'ha menzionata`,
  },
  pt: {
    memberAdded: (a) => `${a} adicionou-o a esta obra`,
    substepValidated: (a, n) => `${a} validou: ${n}`,
    stepValidated: (a, n) => `${a} validou a etapa: ${n}`,
    documentAdded: (a, n) => `${a} adicionou um documento: ${n}`,
    photoAdded: (a) => `${a} adicionou uma fotografia`,
    emergencyTitle: 'Urgência',
    claimTitle: 'Reclamação',
    emergencyReported: (a) => `${a} comunicou uma urgência`,
    claimReported: (a) => `${a} apresentou uma reclamação`,
    feedbackReply: 'Resposta à sua comunicação',
    reportTitle: 'Denúncia',
    reportBody: (where) => `Um conteúdo ou um membro foi denunciado em ${where}. Por favor, verifique.`,
    mentioned: (a) => `${a} mencionou-o`,
  },
  tr: {
    memberAdded: (a) => `${a} sizi bu şantiyeye ekledi`,
    substepValidated: (a, n) => `${a} onayladı: ${n}`,
    stepValidated: (a, n) => `${a} şu aşamayı onayladı: ${n}`,
    documentAdded: (a, n) => `${a} bir belge ekledi: ${n}`,
    photoAdded: (a) => `${a} bir fotoğraf ekledi`,
    emergencyTitle: 'Acil durum',
    claimTitle: 'Şikâyet',
    emergencyReported: (a) => `${a} bir acil durum bildirdi`,
    claimReported: (a) => `${a} bir şikâyet iletti`,
    feedbackReply: 'Bildiriminize yanıt',
    reportTitle: 'Bildirim',
    reportBody: (where) => `${where} üzerinde bir içerik veya üye bildirildi. Lütfen inceleyin.`,
    mentioned: (a) => `${a} sizden bahsetti`,
  },
  pl: {
    // Le polonais accorde ses participes au genre de la personne. Plutot que de
    // supposer tout le monde masculin, on emploie des tournures impersonnelles :
    // le nom de l'auteur reste en tete, le verbe ne s'accorde plus.
    memberAdded: (a) => `${a} — dodano Cię do tej budowy`,
    substepValidated: (a, n) => `${a} — zatwierdzono: ${n}`,
    stepValidated: (a, n) => `${a} — zatwierdzono etap: ${n}`,
    documentAdded: (a, n) => `${a} — nowy dokument: ${n}`,
    photoAdded: (a) => `${a} — nowe zdjęcie`,
    emergencyTitle: 'Nagły wypadek',
    claimTitle: 'Reklamacja',
    emergencyReported: (a) => `${a} — zgłoszono nagły wypadek`,
    claimReported: (a) => `${a} — złożono reklamację`,
    feedbackReply: 'Odpowiedź na Twoje zgłoszenie',
    reportTitle: 'Zgłoszenie',
    reportBody: (where) => `Na ${where} zgłoszono treść lub członka. Prosimy o sprawdzenie.`,
    mentioned: (a) => `${a} — oznaczono Cię w wiadomości`,
  },
};

/** Textes de la langue demandee, francais si elle est absente ou inconnue. */
function strings(locale?: string): PushStrings {
  return PUSH[isPushLocale(locale) ? locale : 'fr'];
}

// --------------- Constructeurs de messages ---------------
//
// Chacun renvoie une fonction de la langue du destinataire : une notification de
// chantier part a plusieurs personnes a la fois, qui ne parlent pas forcement la
// meme langue.

/** Ajout a un chantier. */
export function memberAddedPush(params: { chantierName: string; actorName: string; chantierId: string }) {
  return (locale: string): PushPayload => ({
    title: `👋 ${params.chantierName}`,
    body: strings(locale).memberAdded(params.actorName),
    data: { type: 'chantier-member', chantier_id: params.chantierId },
  });
}

/** Validation d'une sous-etape. */
export function substepValidatedPush(params: {
  chantierName: string;
  actorName: string;
  substepName: string;
  chantierId: string;
  substepId: string;
}) {
  return (locale: string): PushPayload => ({
    title: `✅ ${params.chantierName}`,
    body: strings(locale).substepValidated(params.actorName, params.substepName),
    data: { type: 'substep-validated', chantier_id: params.chantierId, substep_id: params.substepId },
  });
}

/** Validation d'une etape. */
export function stepValidatedPush(params: {
  chantierName: string;
  actorName: string;
  stepName: string;
  chantierId: string;
  stepId: string;
}) {
  return (locale: string): PushPayload => ({
    title: `✅ ${params.chantierName}`,
    body: strings(locale).stepValidated(params.actorName, params.stepName),
    data: { type: 'step-validated', chantier_id: params.chantierId, step_id: params.stepId },
  });
}

/** Ajout d'un document. */
export function documentAddedPush(params: {
  chantierName: string;
  actorName: string;
  documentName: string;
  chantierId: string;
}) {
  return (locale: string): PushPayload => ({
    title: `📄 ${params.chantierName}`,
    body: strings(locale).documentAdded(params.actorName, truncate(params.documentName, 60)),
    data: { type: 'document', chantier_id: params.chantierId },
  });
}

/** Ajout d'une photo. */
export function photoAddedPush(params: { chantierName: string; actorName: string; chantierId: string }) {
  return (locale: string): PushPayload => ({
    title: `📸 ${params.chantierName}`,
    body: strings(locale).photoAdded(params.actorName),
    data: { type: 'photo', chantier_id: params.chantierId },
  });
}

/** Urgence ou reclamation ouverte sur un chantier. */
export function emergencyPush(params: {
  chantierName: string;
  actorName: string;
  chantierId: string;
  emergencyId: string;
  isClaim: boolean;
}) {
  return (locale: string): PushPayload => {
    const T = strings(locale);
    return {
      title: params.isClaim
        ? `📢 ${T.claimTitle} — ${params.chantierName}`
        : `🚨 ${T.emergencyTitle} — ${params.chantierName}`,
      body: params.isClaim ? T.claimReported(params.actorName) : T.emergencyReported(params.actorName),
      data: { type: 'emergency', chantier_id: params.chantierId, emergency_id: params.emergencyId },
    };
  };
}

/**
 * Nouveau message dans une discussion de chantier, ou sur une urgence.
 *
 * Sans texte a traduire — le corps n'est que le nom de l'auteur et son message.
 * Construit ici quand meme, pour que tout ce qui part en notification se compose
 * au meme endroit.
 */
export function commentPush(params: {
  chantierName: string;
  actorName: string;
  content: string;
  chantierId: string;
  onEmergency?: boolean;
  emergencyId?: string;
}): PushPayload {
  return {
    title: `${params.onEmergency ? '🚨' : '💬'} ${params.chantierName}`,
    body: `${params.actorName} : ${truncate(mentionsToText(params.content), 100)}`,
    data: {
      type: params.onEmergency ? 'emergency-comment' : 'comment',
      chantier_id: params.chantierId,
      ...(params.emergencyId ? { emergency_id: params.emergencyId } : {}),
    },
  };
}

/**
 * Mention dans un message — d'une discussion de chantier ou d'une urgence.
 *
 * Elle passe meme quand les messages ordinaires sont coupes : etre interpelle
 * par son nom n'est pas du bruit. `data` dit ou ouvrir l'application.
 */
export function mentionPush(params: {
  chantierName: string;
  actorName: string;
  content: string;
  chantierId: string;
  commentId: string;
  stepId?: string | null;
  emergencyId?: string;
}) {
  return (locale: string): PushPayload => ({
    title: `@ ${params.chantierName}`,
    body: `${strings(locale).mentioned(params.actorName)} : ${truncate(mentionsToText(params.content), 90)}`,
    data: {
      type: 'mention',
      chantier_id: params.chantierId,
      comment_id: params.commentId,
      ...(params.stepId ? { step_id: params.stepId } : {}),
      ...(params.emergencyId ? { emergency_id: params.emergencyId } : {}),
    },
  });
}

/**
 * Reponse du support a un signalement.
 *
 * Seule notification a ne pas dependre de la langue du COMPTE mais de celle du
 * signalement : c'est la langue dans laquelle la personne a ecrit, donc celle
 * dans laquelle elle lit.
 *
 * Le corps rappelle l'objet du signalement : quelqu'un qui en a envoye plusieurs
 * doit savoir duquel on parle avant d'ouvrir l'application.
 */
export function buildFeedbackReplyPush(params: {
  feedbackId: string;
  subject: string;
  response: string;
  locale?: string;
}): PushPayload {
  return {
    title: `💬 ${strings(params.locale).feedbackReply}`,
    body: `${truncate(params.subject, 40)} — ${truncate(params.response, 90)}`,
    data: { type: 'feedback', feedback_id: params.feedbackId },
  };
}

/** Un signalement a traiter. Pas de nom : l'administrateur verra le detail dans le dashboard. */
export function reportPush(params: { where: string; reportId: string }) {
  return (locale: string): PushPayload => ({
    title: `🚩 ${strings(locale).reportTitle}`,
    body: strings(locale).reportBody(params.where),
    data: { type: 'report', report_id: params.reportId },
  });
}
