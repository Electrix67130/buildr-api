import nodemailer from 'nodemailer';
import env from '@/config/env';
import { INVITATION, PASSWORD_RESET, FEEDBACK_ALERT, DATE_TAG, isMailLocale, MailLocale } from '@/lib/mail-i18n';

const transporter = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      // TLS implicite : 465 est le port standard, 2465 celui de Scaleway
      // Transactional Email. Sur les autres ports (587, 2587) nodemailer
      // negocie STARTTLS.
      secure: env.SMTP_PORT === 465 || env.SMTP_PORT === 2465,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASSWORD,
      },
    })
  : null;

interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  /** Adresse de reponse, quand ce n'est pas l'expediteur (l'auteur d'un signalement). */
  replyTo?: string;
}

async function sendViaResend({ to, subject, html, replyTo }: SendMailOptions): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromAddress(),
      to,
      subject,
      html,
      text: htmlToText(html),
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Resend a répondu ${res.status}: ${detail}`);
  }
}

/**
 * Version texte brut derivee du HTML.
 *
 * Un message HTML seul est un signal negatif fort pour les filtres anti-spam :
 * les vrais expediteurs envoient les deux parties. C'est l'un des rares leviers
 * de delivrabilite qui se joue dans le code plutot que dans le DNS.
 */
function htmlToText(html: string): string {
  return html
    // Les liens sont explicites en texte : "libelle (url)".
    .replace(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<\/(p|div|h[1-6]|tr|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

/**
 * Expediteur affiche. Un nom lisible plutot qu'une adresse nue : les clients
 * mail l'affichent tel quel, et un expediteur anonyme inspire moins confiance
 * au destinataire comme au filtre.
 */
function fromAddress(): string {
  return env.SMTP_FROM.includes('<') ? env.SMTP_FROM : `Buildr <${env.SMTP_FROM}>`;
}

export async function sendMail({ to, subject, html, replyTo }: SendMailOptions): Promise<void> {
  // Prod : Resend (HTTP API). Dev : SMTP si configuré. Sinon : log.
  if (env.RESEND_API_KEY) {
    await sendViaResend({ to, subject, html, replyTo });
    return;
  }

  if (!transporter) {
    console.log(`[MAIL] Ni Resend ni SMTP configuré — mail non envoyé à ${to}`);
    console.log(`[MAIL] Sujet: ${subject}`);
    return;
  }

  await transporter.sendMail({
    from: fromAddress(),
    to,
    subject,
    html,
    text: htmlToText(html),
    ...(replyTo ? { replyTo } : {}),
  });
}

/**
 * Echappe le texte libre avant de l'inserer dans le HTML d'un e-mail.
 *
 * Le prenom et le nom sont choisis librement a l'inscription et repris tels
 * quels dans le message. Sans echappement, quiconque cree un compte peut se
 * nommer `<a href="https://malveillant/">Confirmez votre compte</a>`, inviter
 * l'adresse de son choix, et faire expedier un lien de hameconnage par nos
 * serveurs — signe DKIM, depuis notre domaine, avec toute la confiance que cela
 * inspire.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Version texte du meme nom, pour l'objet du message.
 *
 * L'objet n'est pas du HTML : l'y echapper afficherait `&amp;` a la place d'une
 * esperluette dans « Dupont & Fils ». On retire donc les balises plutot que de
 * les neutraliser.
 */
function stripTags(text: string): string {
  return text.replace(/<[^>]*>/g, '').trim();
}

export function buildInvitationEmail(params: {
  inviterName: string;
  email: string;
  role: string;
  token: string;
  expiresAt: string;
  /** Langue choisie par celui qui invite. Retombe sur le francais si absente. */
  locale?: string;
}): { subject: string; html: string } {
  const lang: MailLocale = isMailLocale(params.locale) ? params.locale : 'fr';
  const T = INVITATION[lang];

  // Un seul lien, https : il ouvre l'app quand elle est installee (liens
  // universels, App Links sur /invite/*), la page web sinon. Un lien profond
  // `buildr://` en plus ne menait nulle part sans l'app, ni sur un ordinateur.
  const webLink = `${env.APP_URL}/invite/${params.token}`;
  const expiresFormatted = new Date(params.expiresAt).toLocaleDateString(DATE_TAG[lang], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const roleLabel = T.roles[params.role] ?? params.role;
  const inviterHtml = escapeHtml(params.inviterName);

  return {
    subject: T.subject(stripTags(params.inviterName)),
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="color: #D97706; font-size: 28px; margin: 0;">Buildr</h1>
          <p style="color: #78716C; margin-top: 4px;">${T.tagline}</p>
        </div>

        <div style="background: #FAFAF9; border: 1px solid #E7E5E4; border-radius: 12px; padding: 24px;">
          <h2 style="color: #1C1917; margin-top: 0;">${T.heading}</h2>
          <p style="color: #57534E; line-height: 1.6;">${T.intro(inviterHtml, roleLabel)}</p>

          <div style="text-align: center; margin: 24px 0;">
            <a href="${webLink}"
               style="display: inline-block; background: #D97706; color: white; text-decoration: none;
                      padding: 12px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
              ${T.cta}
            </a>
          </div>

          <p style="color: #A8A29E; font-size: 13px;">
            ${T.expires(expiresFormatted)}<br>
            ${T.fallback}<br>
            <a href="${webLink}" style="color: #D97706; word-break: break-all; overflow-wrap: anywhere;">${webLink}</a>
          </p>
        </div>

        <p style="color: #A8A29E; font-size: 12px; text-align: center; margin-top: 24px;">
          ${T.tagline}
        </p>
      </div>
    `,
  };
}

export function buildPasswordResetEmail(params: {
  token: string;
  /** Langue de l'utilisateur, renseignee a son inscription. */
  locale?: string;
}): { subject: string; html: string } {
  const lang: MailLocale = isMailLocale(params.locale) ? params.locale : 'fr';
  const T = PASSWORD_RESET[lang];

  // Le bouton principal pointe sur le web, comme pour l'invitation : la demande
  // se fait souvent depuis un ordinateur, ou `buildr://` n'ouvre rien.
  const appLink = `buildr://reset-password/${params.token}`;
  const webLink = `${env.APP_URL}/reset-password/${params.token}`;

  return {
    subject: T.subject,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="color: #D97706; font-size: 28px; margin: 0;">Buildr</h1>
          <p style="color: #78716C; margin-top: 4px;">${T.tagline}</p>
        </div>
        <div style="background: #FAFAF9; border: 1px solid #E7E5E4; border-radius: 12px; padding: 24px;">
          <h2 style="color: #1C1917; margin-top: 0;">${T.heading}</h2>
          <p style="color: #57534E; line-height: 1.6;">${T.intro}</p>
          <div style="text-align: center; margin: 24px 0;">
            <a href="${webLink}"
               style="display: inline-block; background: #D97706; color: white; text-decoration: none;
                      padding: 12px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
              ${T.cta}
            </a>
          </div>
          <p style="color: #A8A29E; font-size: 13px;">
            ${T.expires}<br>
            ${T.fallback}<br>
            <a href="${webLink}" style="color: #D97706; word-break: break-all; overflow-wrap: anywhere;">${webLink}</a><br>
            ${T.ignore}<br>
            <a href="${appLink}" style="color: #D97706;">${T.openInApp}</a>
          </p>
        </div>
        <p style="color: #A8A29E; font-size: 12px; text-align: center; margin-top: 24px;">
          ${T.tagline}
        </p>
      </div>
    `,
  };
}

/**
 * Alerte a la boite support : un utilisateur vient de deposer un signalement.
 *
 * Tout le texte libre (sujet, message, nom, organisation) vient de l'auteur :
 * echappe comme pour l'invitation, sinon un signalement deviendrait un moyen de
 * glisser du HTML dans notre propre boite.
 */
export function buildFeedbackAlertEmail(params: {
  feedbackId: string;
  type: 'bug' | 'suggestion';
  subject: string;
  message: string;
  authorName: string;
  authorEmail: string | null;
  organizationName: string | null;
  platform: string | null;
  appVersion: string | null;
  screen: string | null;
  /** Langue dans laquelle l'auteur a ecrit. */
  feedbackLocale: string;
  /** Langue du support, qui lit l'alerte. */
  locale?: string;
}): { subject: string; html: string } {
  const lang: MailLocale = isMailLocale(params.locale) ? params.locale : 'fr';
  const T = FEEDBACK_ALERT[lang];
  const kind = T.kinds[params.type];
  const consoleLink = `${env.APP_URL}/admin/feedback`;
  const author = escapeHtml(params.authorName) + (params.authorEmail ? ` &lt;${escapeHtml(params.authorEmail)}&gt;` : '');
  const context = [params.platform, params.appVersion && `v${params.appVersion}`, params.screen, params.feedbackLocale]
    .filter(Boolean)
    .map((part) => escapeHtml(String(part)))
    .join(' · ');
  const message = escapeHtml(params.message).replace(/\n/g, '<br>');

  return {
    subject: T.subject(kind, stripTags(params.subject)),
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px;">
        <div style="background: #FAFAF9; border: 1px solid #E7E5E4; border-radius: 12px; padding: 24px;">
          <p style="color: #D97706; font-weight: 600; margin: 0 0 8px;">${T.heading(kind)}</p>
          <h2 style="color: #1C1917; margin: 0 0 16px;">${escapeHtml(params.subject)}</h2>
          <p style="color: #57534E; line-height: 1.6; margin: 0 0 16px;">${message}</p>
          <p style="color: #78716C; font-size: 13px; line-height: 1.6; margin: 0;">
            <strong>${T.from} :</strong> ${author}<br>
            <strong>${T.organization} :</strong> ${params.organizationName ? escapeHtml(params.organizationName) : T.none}<br>
            <strong>${T.context} :</strong> ${context || T.none}
          </p>
          <div style="text-align: center; margin: 24px 0 8px;">
            <a href="${consoleLink}"
               style="display: inline-block; background: #D97706; color: white; text-decoration: none;
                      padding: 12px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
              ${T.cta}
            </a>
          </div>
          <p style="color: #A8A29E; font-size: 12px;">${T.replyHint}</p>
        </div>
        <p style="color: #A8A29E; font-size: 12px; text-align: center; margin-top: 24px;">${T.tagline}</p>
      </div>
    `,
  };
}
