import { describe, it, expect } from 'vitest';
import { MAIL_LOCALES, isMailLocale, INVITATION, PASSWORD_RESET, DATE_TAG } from '@/lib/mail-i18n';

/**
 * Traductions des e-mails transactionnels.
 *
 * Une cle manquante ne se voit pas a la compilation quand la valeur est une
 * chaine parmi d'autres, et personne ne relit ses propres e-mails en turc. Le
 * defaut se decouvre donc chez le destinataire — d'ou ces verifications
 * mecaniques sur les huit langues.
 */

const AUTRES_LANGUES = MAIL_LOCALES.filter((l) => l !== 'fr');
const ROLES = ['admin', 'manager', 'employee', 'client', 'gestionnaire_reseau'];

describe('Traductions des e-mails', () => {
  it('reconnait les langues supportees et rejette les autres', () => {
    expect(MAIL_LOCALES).toHaveLength(8);
    for (const langue of MAIL_LOCALES) expect(isMailLocale(langue)).toBe(true);
    for (const intrus of ['FR', 'zz', '', null, undefined, 42]) expect(isMailLocale(intrus)).toBe(false);
  });

  it.each(MAIL_LOCALES)("l'invitation est complete en %s", (langue) => {
    const T = INVITATION[langue];
    expect(T).toBeDefined();

    // Les memes cles qu'en francais, qui fait foi.
    expect(Object.keys(T).sort()).toEqual(Object.keys(INVITATION.fr).sort());

    for (const [cle, valeur] of Object.entries(T)) {
      if (typeof valeur === 'string') expect(valeur.trim(), `${langue}.${cle}`).not.toBe('');
    }
    expect(T.subject('Marie'), `${langue}.subject`).toContain('Marie');
    expect(T.expires('1 janvier'), `${langue}.expires`).toContain('1 janvier');
    expect(T.intro('Marie', 'Ouvrier'), `${langue}.intro`).toContain('Marie');
  });

  it.each(MAIL_LOCALES)('les cinq roles sont traduits en %s', (langue) => {
    for (const role of ROLES) {
      expect(INVITATION[langue].roles[role], `${langue}.roles.${role}`).toBeTruthy();
    }
  });

  it.each(MAIL_LOCALES)('la reinitialisation de mot de passe est complete en %s', (langue) => {
    const T = PASSWORD_RESET[langue];
    expect(T).toBeDefined();
    expect(Object.keys(T).sort()).toEqual(Object.keys(PASSWORD_RESET.fr).sort());

    for (const [cle, valeur] of Object.entries(T)) {
      expect(valeur.trim(), `${langue}.${cle}`).not.toBe('');
    }
  });

  it.each(AUTRES_LANGUES)('le %s est reellement traduit, pas recopie du francais', (langue) => {
    // Attrape la langue ajoutee a la hate en dupliquant le bloc francais.
    expect(INVITATION[langue].heading).not.toBe(INVITATION.fr.heading);
    expect(INVITATION[langue].cta).not.toBe(INVITATION.fr.cta);
    expect(PASSWORD_RESET[langue].heading).not.toBe(PASSWORD_RESET.fr.heading);
  });

  // Seules les langues qui elident devant une voyelle sont concernees. En
  // espagnol ou en allemand, « un invito » et consorts sont corrects — la meme
  // recherche n'y produirait que du bruit.
  it.each(['fr', 'it'] as const)("aucune apostrophe n'a ete perdue en %s", (langue) => {
    // Regression : des traductions ont ete ecrites en evitant les apostrophes
    // pour contourner l'echappement du shell. Restaient « d une organisation »
    // et « L app mobile ». Illisible, et impossible a reperer a la relecture
    // d'une langue qu'on ne parle pas.
    //
    // Le negatif en tete remplace \b, qui considere les lettres accentuees
    // comme des separateurs : « direccion en » y passait pour un « n » isole.
    // « qu » est traite a part : il s'elide en fin de mot (« jusqu' »,
    // « presqu' », « quelqu' »), il n'a donc pas de frontiere a gauche.
    //
    // Restent hors de portee les elisions qui dependent du genre du mot suivant
    // (« un'organizzazione ») : il faudrait un lexique, pas une expression.
    const suspect = /(?:(?<!\p{L})(?:d|l|j|n|s|c|t|m|dell|nell|all|dall|sull)|qu)\s+[aeiouhàâäéèêëîïôöùûü]/iu;

    const textes = [
      ...Object.values(INVITATION[langue]).filter((v): v is string => typeof v === 'string'),
      ...Object.values(INVITATION[langue].roles),
      ...Object.values(PASSWORD_RESET[langue]),
      INVITATION[langue].subject('Marie'),
      INVITATION[langue].intro('Marie', 'Ouvrier'),
      INVITATION[langue].expires('1 janvier 2026'),
    ];

    for (const texte of textes) {
      expect(texte, `${langue} : « ${texte} »`).not.toMatch(suspect);
    }
  });

  it('repere bien une apostrophe manquante', () => {
    // Verifie que le filtre ci-dessus n'est pas devenu aveugle a force d'etre
    // affine : voici exactement ce qu'il doit attraper.
    const suspect = /(?:(?<!\p{L})(?:d|l|j|n|s|c|t|m|dell|nell|all|dall|sull)|qu)\s+[aeiouhàâäéèêëîïôöùûü]/iu;

    for (const faute of ["Membre d une organisation", "L app mobile", "Jusqu a demain", "nell area riservata"]) {
      expect(faute).toMatch(suspect);
    }
    for (const correct of ["Membre d'une organisation", "L'app mobile", "Gestion de chantiers", "Vous êtes invité !"]) {
      expect(correct).not.toMatch(suspect);
    }
  });

  it('associe a chaque langue une etiquette de date valide', () => {
    for (const langue of MAIL_LOCALES) {
      const tag = DATE_TAG[langue];
      expect(tag, langue).toBeTruthy();
      // Doit etre acceptee par Intl, sinon toLocaleDateString leve a l'envoi.
      expect(() => new Date().toLocaleDateString(tag, { day: 'numeric', month: 'long' })).not.toThrow();
      expect(Intl.DateTimeFormat.supportedLocalesOf([tag]), langue).toHaveLength(1);
    }
  });

  it('produit des dates reellement differentes selon la langue', () => {
    const date = new Date('2026-01-15T12:00:00Z');
    const rendu = (tag: string) => date.toLocaleDateString(tag, { day: 'numeric', month: 'long', year: 'numeric' });

    expect(rendu(DATE_TAG.fr)).toContain('janvier');
    expect(rendu(DATE_TAG.en)).toContain('January');
    expect(rendu(DATE_TAG.de)).toContain('Januar');
  });
});
