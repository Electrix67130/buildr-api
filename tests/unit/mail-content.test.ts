import { describe, it, expect } from 'vitest';
import { buildInvitationEmail, buildPasswordResetEmail, buildFeedbackAlertEmail } from '@/lib/mailer';
import { INVITATION, PASSWORD_RESET, FEEDBACK_ALERT, MAIL_LOCALES } from '@/lib/mail-i18n';

/**
 * Contenu des e-mails transactionnels.
 *
 * Ces deux messages sont le seul lien avec quelqu'un qui n'a pas encore de
 * compte, ou qui ne peut plus y entrer. Un lien casse dedans ne remonte jamais :
 * le destinataire abandonne sans rien signaler.
 */

const DANS_UNE_SEMAINE = new Date('2026-01-15T12:00:00Z').toISOString();

const invitation = (extra: Partial<Parameters<typeof buildInvitationEmail>[0]> = {}) =>
  buildInvitationEmail({
    inviterName: 'Marie Dupont',
    email: 'arthur@alpha.fr',
    role: 'employee',
    token: 'jeton-123',
    expiresAt: DANS_UNE_SEMAINE,
    ...extra,
  });

describe("E-mail d'invitation", () => {
  it('ne propose que le lien web, sans lien profond', () => {
    // Regression : le bouton pointait sur buildr://, que seul un telephone
    // ayant deja l'app peut ouvrir. Or on ouvre le plus souvent son courrier
    // depuis un poste de bureau — le bouton ne faisait rien. Le lien https
    // ouvre lui-meme l'app quand elle est installee (liens universels).
    const { html } = invitation();

    expect(html).toContain('href="http://localhost:3001/invite/jeton-123"');
    expect(html).not.toContain('buildr://');
  });

  it('ecrit le message dans la langue choisie par celui qui invite', () => {
    const { subject, html } = invitation({ locale: 'de' });

    expect(subject).toBe(INVITATION.de.subject('Marie Dupont'));
    expect(html).toContain(INVITATION.de.heading);
    expect(html).toContain(INVITATION.de.cta);
  });

  it.each(['fr', 'en', 'de', 'es', 'it', 'pt', 'tr', 'pl'] as const)('produit un message complet en %s', (langue) => {
    const { subject, html } = invitation({ locale: langue });

    expect(subject).toBe(INVITATION[langue].subject('Marie Dupont'));
    expect(html).toContain(INVITATION[langue].cta);
    expect(html).toContain('/invite/jeton-123');
    expect(html).not.toContain('undefined');
  });

  it('retombe sur le francais pour une langue inconnue', () => {
    for (const langue of ['zz', '', 'FR', undefined]) {
      expect(invitation({ locale: langue }).subject).toBe(INVITATION.fr.subject('Marie Dupont'));
    }
  });

  it('traduit aussi le nom du role', () => {
    expect(invitation({ role: 'manager', locale: 'fr' }).html).toContain('Chef de chantier');
    expect(invitation({ role: 'manager', locale: 'en' }).html).toContain('Site manager');
  });

  it("affiche le role tel quel s'il n'a pas de traduction", () => {
    expect(invitation({ role: 'role_inconnu' }).html).toContain('role_inconnu');
  });

  it("date la peremption dans la langue du message", () => {
    expect(invitation({ locale: 'fr' }).html).toContain('15 janvier 2026');
    expect(invitation({ locale: 'de' }).html).toContain('15. Januar 2026');
  });

  it("echappe le nom de celui qui invite", () => {
    // Le prenom et le nom sont libres a l'inscription et repris tels quels dans
    // le HTML. Sans echappement, quiconque cree un compte peut glisser un lien
    // de son choix dans un e-mail expedie et signe par nos serveurs — un
    // hameconnage avec la caution du domaine.
    const { subject, html } = invitation({
      inviterName: '<a href="https://malveillant.example/">Confirmez votre compte</a>',
    });

    expect(html).not.toContain('<a href="https://malveillant.example/">');
    expect(html).toContain('&lt;a href=');
    expect(subject).not.toContain('<a href=');
  });
});

describe('E-mail de reinitialisation de mot de passe', () => {
  it('dirige le bouton principal vers le web', () => {
    const { html } = buildPasswordResetEmail({ token: 'jeton-abc' });

    expect(html).toContain('href="http://localhost:3001/reset-password/jeton-abc"');
    expect(html).toContain('buildr://reset-password/jeton-abc');
  });

  it("ecrit le message dans la langue de l'utilisateur", () => {
    const { subject, html } = buildPasswordResetEmail({ token: 'jeton-abc', locale: 'pl' });

    expect(subject).toBe(PASSWORD_RESET.pl.subject);
    expect(html).toContain(PASSWORD_RESET.pl.heading);
  });

  it('retombe sur le francais pour une langue inconnue', () => {
    expect(buildPasswordResetEmail({ token: 'x', locale: 'zz' }).subject).toBe(PASSWORD_RESET.fr.subject);
  });

  it.each(['fr', 'en', 'de', 'es', 'it', 'pt', 'tr', 'pl'] as const)('produit un message complet en %s', (langue) => {
    const { html } = buildPasswordResetEmail({ token: 'jeton-abc', locale: langue });

    expect(html).toContain(PASSWORD_RESET[langue].cta);
    expect(html).toContain('/reset-password/jeton-abc');
    expect(html).not.toContain('undefined');
  });
});

describe('Alerte support : nouveau signalement', () => {
  const signalement = {
    feedbackId: 'f1',
    type: 'bug' as const,
    subject: 'La galerie reste vide',
    message: 'Ligne 1\nLigne 2',
    authorName: 'Marie Durand',
    authorEmail: 'marie@exemple.fr',
    organizationName: 'Alpha TP',
    platform: 'mobile',
    appVersion: '1.1.0',
    screen: 'chantier/[id]',
    feedbackLocale: 'fr',
  };

  it("donne le sujet, l'auteur, l'organisation, la version et le lien vers la console", () => {
    const { subject, html } = buildFeedbackAlertEmail(signalement);
    expect(subject).toBe('[Buildr] Nouveau bug : La galerie reste vide');
    expect(html).toContain('Marie Durand &lt;marie@exemple.fr&gt;');
    expect(html).toContain('Alpha TP');
    expect(html).toContain('v1.1.0');
    expect(html).toContain('Ligne 1<br>Ligne 2');
    expect(html).toContain('/admin/feedback');
  });

  it("echappe tout ce que l'auteur a ecrit", () => {
    const { html } = buildFeedbackAlertEmail({
      ...signalement,
      subject: '<b>gras</b>',
      message: '<a href="https://malveillant/">clic</a>',
      authorName: '<img src=x>',
      organizationName: 'Dupont & Fils',
    });
    expect(html).not.toContain('<a href="https://malveillant/"');
    expect(html).not.toContain('<img');
    expect(html).toContain('Dupont &amp; Fils');
  });

  it.each(MAIL_LOCALES)('est complete en %s', (langue) => {
    expect(Object.keys(FEEDBACK_ALERT[langue]).sort()).toEqual(Object.keys(FEEDBACK_ALERT.fr).sort());
    const { subject } = buildFeedbackAlertEmail({ ...signalement, type: 'suggestion', locale: langue });
    expect(subject).toContain(FEEDBACK_ALERT[langue].kinds.suggestion);
  });
});
