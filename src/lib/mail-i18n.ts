/**
 * Textes des e-mails transactionnels, par langue.
 *
 * Separes de `mailer.ts` : celui-ci assemble et expedie, celui-la ne porte que
 * du contenu. Les deux evoluent a des rythmes differents — on ajoute une langue
 * bien plus souvent qu'on ne change de transporteur.
 *
 * Le francais fait foi : toute cle absente d'une langue y retombe.
 */
export const MAIL_LOCALES = ['fr', 'en', 'de', 'es', 'it', 'pt', 'tr', 'pl'] as const;
export type MailLocale = (typeof MAIL_LOCALES)[number];

export function isMailLocale(value: unknown): value is MailLocale {
  return typeof value === 'string' && (MAIL_LOCALES as readonly string[]).includes(value);
}

interface InvitationStrings {
  subject: (inviter: string) => string;
  heading: string;
  intro: (inviter: string, role: string) => string;
  cta: string;
  expires: (date: string) => string;
  fallback: string;
  hasApp: string;
  openInApp: string;
  tagline: string;
  roles: Record<string, string>;
}

export const INVITATION: Record<MailLocale, InvitationStrings> = {
  fr: {
    subject: (i) => `${i} vous invite à rejoindre Buildr`,
    heading: 'Vous êtes invité !',
    intro: (i, r) => `<strong>${i}</strong> vous invite à rejoindre la plateforme Buildr en tant que <strong>${r}</strong>.`,
    cta: "Accepter l'invitation",
    expires: (d) => `Cette invitation expire le ${d}.`,
    fallback: 'Si le bouton ne fonctionne pas, copiez cette adresse dans votre navigateur :',
    hasApp: "Vous avez déjà l'application Buildr ?",
    openInApp: "Ouvrir directement dans l'app",
    tagline: 'Buildr — Gestion de chantiers',
    roles: { admin: 'Administrateur', manager: 'Chef de chantier', employee: 'Ouvrier', client: 'Client', gestionnaire_reseau: 'Gestionnaire réseau' },
  },
  en: {
    subject: (i) => `${i} invites you to join Buildr`,
    heading: 'You have been invited',
    intro: (i, r) => `<strong>${i}</strong> invites you to join Buildr as <strong>${r}</strong>.`,
    cta: 'Accept the invitation',
    expires: (d) => `This invitation expires on ${d}.`,
    fallback: 'If the button does not work, copy this address into your browser:',
    hasApp: 'Already have the Buildr app?',
    openInApp: 'Open directly in the app',
    tagline: 'Buildr — Construction site management',
    roles: { admin: 'Administrator', manager: 'Site manager', employee: 'Worker', client: 'Client', gestionnaire_reseau: 'Network manager' },
  },
  de: {
    subject: (i) => `${i} lädt Sie zu Buildr ein`,
    heading: 'Sie wurden eingeladen',
    intro: (i, r) => `<strong>${i}</strong> lädt Sie ein, Buildr als <strong>${r}</strong> beizutreten.`,
    cta: 'Einladung annehmen',
    expires: (d) => `Diese Einladung läuft am ${d} ab.`,
    fallback: 'Wenn die Schaltfläche nicht funktioniert, kopieren Sie diese Adresse in Ihren Browser:',
    hasApp: 'Sie haben die Buildr-App bereits?',
    openInApp: 'Direkt in der App öffnen',
    tagline: 'Buildr — Baustellenverwaltung',
    roles: { admin: 'Administrator', manager: 'Bauleiter', employee: 'Mitarbeiter', client: 'Kunde', gestionnaire_reseau: 'Netzbetreiber' },
  },
  es: {
    subject: (i) => `${i} le invita a unirse a Buildr`,
    heading: 'Ha recibido una invitación',
    intro: (i, r) => `<strong>${i}</strong> le invita a unirse a Buildr como <strong>${r}</strong>.`,
    cta: 'Aceptar la invitación',
    expires: (d) => `Esta invitación caduca el ${d}.`,
    fallback: 'Si el botón no funciona, copie esta dirección en su navegador:',
    hasApp: '¿Ya tiene la aplicación Buildr?',
    openInApp: 'Abrir directamente en la app',
    tagline: 'Buildr — Gestión de obras',
    roles: { admin: 'Administrador', manager: 'Jefe de obra', employee: 'Operario', client: 'Cliente', gestionnaire_reseau: 'Gestor de red' },
  },
  it: {
    subject: (i) => `${i} la invita su Buildr`,
    heading: 'Ha ricevuto un invito',
    intro: (i, r) => `<strong>${i}</strong> la invita a unirsi a Buildr come <strong>${r}</strong>.`,
    cta: "Accetta l'invito",
    expires: (d) => `Questo invito scade il ${d}.`,
    fallback: 'Se il pulsante non funziona, copi questo indirizzo nel suo browser:',
    hasApp: "Ha già l'applicazione Buildr?",
    openInApp: "Apri direttamente nell'app",
    tagline: 'Buildr — Gestione cantieri',
    roles: { admin: 'Amministratore', manager: 'Capocantiere', employee: 'Operaio', client: 'Cliente', gestionnaire_reseau: 'Gestore di rete' },
  },
  pt: {
    subject: (i) => `${i} convida-o a juntar-se ao Buildr`,
    heading: 'Recebeu um convite',
    intro: (i, r) => `<strong>${i}</strong> convida-o a juntar-se ao Buildr como <strong>${r}</strong>.`,
    cta: 'Aceitar o convite',
    expires: (d) => `Este convite expira a ${d}.`,
    fallback: 'Se o botão não funcionar, copie este endereço para o seu navegador:',
    hasApp: 'Já tem a aplicação Buildr?',
    openInApp: 'Abrir diretamente na aplicação',
    tagline: 'Buildr — Gestão de obras',
    roles: { admin: 'Administrador', manager: 'Chefe de obra', employee: 'Trabalhador', client: 'Cliente', gestionnaire_reseau: 'Gestor de rede' },
  },
  tr: {
    subject: (i) => `${i} sizi Buildr'a davet ediyor`,
    heading: 'Davet aldınız',
    intro: (i, r) => `<strong>${i}</strong> sizi <strong>${r}</strong> olarak Buildr'a davet ediyor.`,
    cta: 'Daveti kabul et',
    expires: (d) => `Bu davet ${d} tarihinde sona erer.`,
    fallback: 'Düğme çalışmıyorsa bu adresi tarayıcınıza kopyalayın:',
    hasApp: 'Buildr uygulaması sizde var mı?',
    openInApp: 'Doğrudan uygulamada aç',
    tagline: 'Buildr — Şantiye yönetimi',
    roles: { admin: 'Yönetici', manager: 'Şantiye şefi', employee: 'Çalışan', client: 'Müşteri', gestionnaire_reseau: 'Şebeke sorumlusu' },
  },
  pl: {
    subject: (i) => `${i} zaprasza Cię do Buildr`,
    heading: 'Otrzymałeś zaproszenie',
    intro: (i, r) => `<strong>${i}</strong> zaprasza Cię do Buildr jako <strong>${r}</strong>.`,
    cta: 'Zaakceptuj zaproszenie',
    expires: (d) => `To zaproszenie wygasa ${d}.`,
    fallback: 'Jeśli przycisk nie działa, skopiuj ten adres do przeglądarki:',
    hasApp: 'Masz już aplikację Buildr?',
    openInApp: 'Otwórz bezpośrednio w aplikacji',
    tagline: 'Buildr — Zarządzanie budowami',
    roles: { admin: 'Administrator', manager: 'Kierownik budowy', employee: 'Pracownik', client: 'Klient', gestionnaire_reseau: 'Zarządca sieci' },
  },
};


interface ResetStrings {
  subject: string;
  heading: string;
  intro: string;
  cta: string;
  expires: string;
  ignore: string;
  fallback: string;
  tagline: string;
}

export const PASSWORD_RESET: Record<MailLocale, ResetStrings> = {
  fr: {
    subject: 'Buildr — Réinitialisation de votre mot de passe',
    heading: 'Réinitialisation du mot de passe',
    intro: 'Vous avez demandé à réinitialiser votre mot de passe. Cliquez sur le bouton ci-dessous pour en choisir un nouveau.',
    cta: 'Réinitialiser mon mot de passe',
    expires: 'Ce lien expire dans 30 minutes.',
    ignore: "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.",
    fallback: 'Si le bouton ne fonctionne pas, copiez cette adresse dans votre navigateur :',
    tagline: 'Buildr — Gestion de chantiers',
  },
  en: {
    subject: 'Buildr — Reset your password',
    heading: 'Password reset',
    intro: 'You asked to reset your password. Click the button below to choose a new one.',
    cta: 'Reset my password',
    expires: 'This link expires in 30 minutes.',
    ignore: 'If you did not make this request, ignore this message: your password remains unchanged.',
    fallback: 'If the button does not work, copy this address into your browser:',
    tagline: 'Buildr — Construction site management',
  },
  de: {
    subject: 'Buildr — Passwort zurücksetzen',
    heading: 'Passwort zurücksetzen',
    intro: 'Sie haben das Zurücksetzen Ihres Passworts angefordert. Klicken Sie auf die Schaltfläche, um ein neues zu wählen.',
    cta: 'Passwort zurücksetzen',
    expires: 'Dieser Link läuft in 30 Minuten ab.',
    ignore: 'Wenn Sie diese Anfrage nicht gestellt haben, ignorieren Sie diese Nachricht: Ihr Passwort bleibt unverändert.',
    fallback: 'Wenn die Schaltfläche nicht funktioniert, kopieren Sie diese Adresse in Ihren Browser:',
    tagline: 'Buildr — Baustellenverwaltung',
  },
  es: {
    subject: 'Buildr — Restablecer su contraseña',
    heading: 'Restablecimiento de contraseña',
    intro: 'Ha solicitado restablecer su contraseña. Pulse el botón siguiente para elegir una nueva.',
    cta: 'Restablecer mi contraseña',
    expires: 'Este enlace caduca en 30 minutos.',
    ignore: 'Si no ha realizado esta solicitud, ignore este mensaje: su contraseña no cambia.',
    fallback: 'Si el botón no funciona, copie esta dirección en su navegador:',
    tagline: 'Buildr — Gestión de obras',
  },
  it: {
    subject: 'Buildr — Reimposta la sua password',
    heading: 'Reimpostazione della password',
    intro: 'Ha chiesto di reimpostare la sua password. Clicchi sul pulsante qui sotto per sceglierne una nuova.',
    cta: 'Reimposta la mia password',
    expires: 'Questo link scade tra 30 minuti.',
    ignore: 'Se non ha effettuato questa richiesta, ignori questo messaggio: la sua password resta invariata.',
    fallback: 'Se il pulsante non funziona, copi questo indirizzo nel suo browser:',
    tagline: 'Buildr — Gestione cantieri',
  },
  pt: {
    subject: 'Buildr — Repor a sua palavra-passe',
    heading: 'Reposição da palavra-passe',
    intro: 'Pediu para repor a sua palavra-passe. Carregue no botão abaixo para escolher uma nova.',
    cta: 'Repor a minha palavra-passe',
    expires: 'Este link expira em 30 minutos.',
    ignore: 'Se não fez este pedido, ignore esta mensagem: a sua palavra-passe permanece inalterada.',
    fallback: 'Se o botão não funcionar, copie este endereço para o seu navegador:',
    tagline: 'Buildr — Gestão de obras',
  },
  tr: {
    subject: 'Buildr — Şifrenizi sıfırlayın',
    heading: 'Şifre sıfırlama',
    intro: 'Şifrenizi sıfırlamayı talep ettiniz. Yeni bir şifre seçmek için aşağıdaki düğmeye tıklayın.',
    cta: 'Şifremi sıfırla',
    expires: 'Bu bağlantı 30 dakika içinde sona erer.',
    ignore: 'Bu talebi siz yapmadıysanız bu mesajı yok sayın: şifreniz değişmez.',
    fallback: 'Düğme çalışmıyorsa bu adresi tarayıcınıza kopyalayın:',
    tagline: 'Buildr — Şantiye yönetimi',
  },
  pl: {
    subject: 'Buildr — Zresetuj hasło',
    heading: 'Resetowanie hasła',
    intro: 'Poprosiłeś o zresetowanie hasła. Kliknij przycisk poniżej, aby wybrać nowe.',
    cta: 'Zresetuj moje hasło',
    expires: 'Ten link wygasa za 30 minut.',
    ignore: 'Jeśli to nie Ty wysłałeś tę prośbę, zignoruj tę wiadomość: Twoje hasło pozostaje bez zmian.',
    fallback: 'Jeśli przycisk nie działa, skopiuj ten adres do przeglądarki:',
    tagline: 'Buildr — Zarządzanie budowami',
  },
};

/** Étiquette BCP-47 pour toLocaleDateString, la clé seule suffisant rarement. */
export const DATE_TAG: Record<MailLocale, string> = {
  fr: 'fr-FR', en: 'en-GB', de: 'de-DE', es: 'es-ES',
  it: 'it-IT', pt: 'pt-PT', tr: 'tr-TR', pl: 'pl-PL',
};
