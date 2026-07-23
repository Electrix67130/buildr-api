import nodemailer from 'nodemailer';
import env from '@/config/env';

const transporter = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
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
}

async function sendViaResend({ to, subject, html }: SendMailOptions): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: env.SMTP_FROM, to, subject, html }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Resend a répondu ${res.status}: ${detail}`);
  }
}

export async function sendMail({ to, subject, html }: SendMailOptions): Promise<void> {
  // Prod : Resend (HTTP API). Dev : SMTP si configuré. Sinon : log.
  if (env.RESEND_API_KEY) {
    await sendViaResend({ to, subject, html });
    return;
  }

  if (!transporter) {
    console.log(`[MAIL] Ni Resend ni SMTP configuré — mail non envoyé à ${to}`);
    console.log(`[MAIL] Sujet: ${subject}`);
    return;
  }

  await transporter.sendMail({
    from: env.SMTP_FROM,
    to,
    subject,
    html,
  });
}

export function buildInvitationEmail(params: {
  inviterName: string;
  email: string;
  role: string;
  token: string;
  expiresAt: string;
}): { subject: string; html: string } {
  // Deep link into the app (Expo scheme 'buildr://') + web fallback
  const appLink = `buildr://invite/${params.token}`;
  const webLink = `${env.APP_URL}/invite/${params.token}`;
  const inviteUrl = appLink;
  const expiresFormatted = new Date(params.expiresAt).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const roleLabels: Record<string, string> = {
    admin: 'Administrateur',
    employee: 'Employé',
    client: 'Client',
  };

  return {
    subject: `${params.inviterName} vous invite à rejoindre Buildr`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 32px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <h1 style="color: #D97706; font-size: 28px; margin: 0;">Buildr</h1>
          <p style="color: #78716C; margin-top: 4px;">Gestion de chantiers</p>
        </div>

        <div style="background: #FAFAF9; border: 1px solid #E7E5E4; border-radius: 12px; padding: 24px;">
          <h2 style="color: #1C1917; margin-top: 0;">Vous êtes invité !</h2>
          <p style="color: #57534E; line-height: 1.6;">
            <strong>${params.inviterName}</strong> vous invite à rejoindre la plateforme Buildr
            en tant que <strong>${roleLabels[params.role] || params.role}</strong>.
          </p>

          <div style="text-align: center; margin: 24px 0;">
            <a href="${appLink}"
               style="display: inline-block; background: #D97706; color: white; text-decoration: none;
                      padding: 12px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
              Accepter l'invitation
            </a>
          </div>

          <p style="color: #A8A29E; font-size: 13px;">
            Cette invitation expire le ${expiresFormatted}.<br>
            Ouvrir dans l'app : <a href="${appLink}" style="color: #D97706;">${appLink}</a><br>
            Ou version web : <a href="${webLink}" style="color: #D97706;">${webLink}</a>
          </p>
        </div>

        <p style="color: #A8A29E; font-size: 12px; text-align: center; margin-top: 24px;">
          Buildr — Gestion de chantiers
        </p>
      </div>
    `,
  };
}
