import { describe, it, expect } from 'vitest';
import { registerSchema, loginSchema, resetPasswordSchema, updatePasswordSchema } from '@/modules/auth/auth.schema';
import { createInvitationSchema } from '@/modules/invitation/invitation.schema';
import { updateUserSchema, deleteAccountSchema, toPublicUser } from '@/modules/user/user.schema';

/**
 * Validation des entrees.
 *
 * Les schemas Zod sont la seule barriere entre le monde exterieur et la base :
 * les services ne revalident rien. Ce qui passe ici est ecrit tel quel.
 */

describe("Inscription", () => {
  const valide = {
    email: 'arthur@alpha.fr',
    password: 'MotDePasse123!',
    first_name: 'Arthur',
    last_name: 'Durand',
    phone: '0611223344',
  };

  it('accepte une inscription minimale et applique les valeurs par defaut', () => {
    const data = registerSchema.parse(valide);

    expect(data.role).toBe('employee');
    expect(data.platform).toBe('web');
  });

  it('refuse un mot de passe trop court', () => {
    expect(registerSchema.safeParse({ ...valide, password: 'court12' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valide, password: 'juste8ok' }).success).toBe(true);
  });

  it('refuse une adresse mal formee', () => {
    for (const email of ['pas-un-email', 'a@', '@alpha.fr', '']) {
      expect(registerSchema.safeParse({ ...valide, email }).success, email).toBe(false);
    }
  });

  it('exige un nom, un prenom et un telephone', () => {
    for (const champ of ['first_name', 'last_name', 'phone'] as const) {
      expect(registerSchema.safeParse({ ...valide, [champ]: '' }).success, champ).toBe(false);
      expect(registerSchema.safeParse({ ...valide, [champ]: undefined }).success, champ).toBe(false);
    }
  });

  it("n'accepte que les huit langues supportees", () => {
    for (const locale of ['fr', 'en', 'de', 'es', 'it', 'pt', 'tr', 'pl']) {
      expect(registerSchema.safeParse({ ...valide, locale }).success, locale).toBe(true);
    }
    for (const locale of ['zz', 'FR', 'fr-FR', 'ru']) {
      expect(registerSchema.safeParse({ ...valide, locale }).success, locale).toBe(false);
    }
  });

  it("ne laisse pas s'inscrire directement comme manager", () => {
    // Les roles d'encadrement passent forcement par une invitation.
    expect(registerSchema.safeParse({ ...valide, role: 'manager' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valide, role: 'admin' }).success).toBe(true);
  });

  it("valide le format des informations legales de l'organisation", () => {
    const avecOrg = (organization: Record<string, unknown>) => registerSchema.safeParse({ ...valide, organization });

    expect(avecOrg({ siret: '12345678901234' }).success).toBe(true);
    expect(avecOrg({ siret: '123' }).success).toBe(false);
    expect(avecOrg({ siret: 'douze-chiffres!' }).success).toBe(false);
    expect(avecOrg({ naf_code: '4321A' }).success).toBe(true);
    expect(avecOrg({ naf_code: '4321' }).success).toBe(false);
    expect(avecOrg({ country: 'FR' }).success).toBe(true);
    expect(avecOrg({ country: 'France' }).success).toBe(false);
    expect(avecOrg({ website: 'pas-une-url' }).success).toBe(false);
    expect(avecOrg({ billing_email: 'compta@alpha.fr' }).success).toBe(true);
  });

  it('ignore les champs inconnus au lieu de les enregistrer', () => {
    const data = registerSchema.parse({ ...valide, is_super_admin: true, id: 'choisi-par-le-client' });

    expect(data).not.toHaveProperty('is_super_admin');
    expect(data).not.toHaveProperty('id');
  });
});

describe('Connexion', () => {
  it('applique la plateforme web par defaut', () => {
    const data = loginSchema.parse({ email: 'a@b.fr', password: 'x' });
    expect(data.platform).toBe('web');
  });

  it("n'accepte que les deux plateformes connues", () => {
    expect(loginSchema.safeParse({ email: 'a@b.fr', password: 'x', platform: 'mobile' }).success).toBe(true);
    expect(loginSchema.safeParse({ email: 'a@b.fr', password: 'x', platform: 'desktop' }).success).toBe(false);
  });
});

describe('Mot de passe', () => {
  it('impose la meme longueur minimale au changement et a la reinitialisation', () => {
    expect(updatePasswordSchema.safeParse({ current_password: 'x', new_password: 'court12' }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ token: 't', new_password: 'court12' }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ token: 't', new_password: 'assezlong' }).success).toBe(true);
  });

  it('exige le mot de passe actuel pour supprimer son compte', () => {
    // Un jeton vole ne doit pas suffire a detruire un compte.
    expect(deleteAccountSchema.safeParse({}).success).toBe(false);
    expect(deleteAccountSchema.safeParse({ password: '' }).success).toBe(false);
    expect(deleteAccountSchema.safeParse({ password: 'x' }).success).toBe(true);
  });
});

describe('Invitation', () => {
  it('invite un ouvrier en francais par defaut', () => {
    const data = createInvitationSchema.parse({ email: 'arthur@alpha.fr' });

    expect(data.role).toBe('employee');
    expect(data.locale).toBe('fr');
  });

  it('accepte les cinq roles attribuables', () => {
    for (const role of ['admin', 'manager', 'employee', 'client', 'gestionnaire_reseau']) {
      expect(createInvitationSchema.safeParse({ email: 'a@b.fr', role }).success, role).toBe(true);
    }
    expect(createInvitationSchema.safeParse({ email: 'a@b.fr', role: 'super_admin' }).success).toBe(false);
  });

  it("n'accepte que les huit langues supportees", () => {
    expect(createInvitationSchema.safeParse({ email: 'a@b.fr', locale: 'tr' }).success).toBe(true);
    expect(createInvitationSchema.safeParse({ email: 'a@b.fr', locale: 'ru' }).success).toBe(false);
  });
});

describe('Modification de profil', () => {
  it('accepte une modification partielle', () => {
    expect(updateUserSchema.parse({ phone: '0611223344' })).toEqual({ phone: '0611223344' });
    expect(updateUserSchema.parse({})).toEqual({});
  });

  it("permet d'effacer son avatar", () => {
    expect(updateUserSchema.safeParse({ avatar_url: null }).success).toBe(true);
  });

  it('refuse un role inconnu', () => {
    expect(updateUserSchema.safeParse({ role: 'super_admin' }).success).toBe(false);
    expect(updateUserSchema.safeParse({ role: 'manager' }).success).toBe(true);
  });

  it('laisse changer la langue de ses e-mails', () => {
    // Sans ce champ, `user.locale` etait fige a l'inscription : on recevait ses
    // e-mails en francais a vie.
    for (const locale of ['fr', 'en', 'de', 'es', 'it', 'pt', 'tr', 'pl']) {
      expect(updateUserSchema.safeParse({ locale }).success, locale).toBe(true);
    }
    for (const locale of ['zz', 'FR', 'fr-FR', '']) {
      expect(updateUserSchema.safeParse({ locale }).success, locale).toBe(false);
    }
  });

  it("ne laisse pas modifier ce qui n'est pas modifiable", () => {
    const data = updateUserSchema.parse({
      phone: '0611223344',
      password_hash: 'injecte',
      organization_id: 'autre-org',
      id: 'autre-id',
    });

    expect(data).toEqual({ phone: '0611223344' });
  });
});

describe('Assainissement des reponses utilisateur', () => {
  it('retire le mot de passe et les identifiants de session', () => {
    const rendu = toPublicUser({
      id: 'u1',
      email: 'arthur@alpha.fr',
      password_hash: '$2b$12$secret',
      current_mobile_session_id: 'session-mobile',
      current_web_session_id: 'session-web',
      first_name: 'Arthur',
    });

    expect(rendu).toEqual({ id: 'u1', email: 'arthur@alpha.fr', first_name: 'Arthur' });
    expect(JSON.stringify(rendu)).not.toContain('secret');
  });
});
