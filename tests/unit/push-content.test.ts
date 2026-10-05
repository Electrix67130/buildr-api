import { describe, it, expect } from 'vitest';
import {
  PUSH,
  PUSH_LOCALES,
  buildFeedbackReplyPush,
  memberAddedPush,
  substepValidatedPush,
  stepValidatedPush,
  documentAddedPush,
  photoAddedPush,
  emergencyPush,
  commentPush,
  reportPush,
} from '@/lib/push-i18n';

/**
 * Contenu des notifications push.
 *
 * Une notification est lue en une seconde, sur un ecran verrouille, souvent
 * dehors. Si elle ne dit pas de quoi elle parle, elle ne sert a rien — et
 * l'ecrire dans une langue que le destinataire ne lit pas revient a ne rien
 * envoyer.
 */

const CHANTIER = { chantierName: 'Pont de la Loire', chantierId: 'c-1', actorName: 'Marie Dupont' };

/** Tous les constructeurs dependants de la langue, avec de quoi les appeler. */
const CONSTRUCTEURS = [
  ['ajout au chantier', memberAddedPush({ ...CHANTIER })],
  ['sous-etape validee', substepValidatedPush({ ...CHANTIER, substepName: 'Coffrage', substepId: 's-1' })],
  ['etape validee', stepValidatedPush({ ...CHANTIER, stepName: 'Fondations', stepId: 'e-1' })],
  ['document ajoute', documentAddedPush({ ...CHANTIER, documentName: 'Plan de masse.pdf' })],
  ['photo ajoutee', photoAddedPush({ ...CHANTIER })],
  ['urgence', emergencyPush({ ...CHANTIER, emergencyId: 'u-1', isClaim: false })],
  ['reclamation', emergencyPush({ ...CHANTIER, emergencyId: 'u-1', isClaim: true })],
] as const;

describe('Traductions des notifications', () => {
  it('couvre les huit langues du produit', () => {
    expect(PUSH_LOCALES).toHaveLength(8);
    for (const langue of PUSH_LOCALES) expect(PUSH[langue], langue).toBeDefined();
  });

  it.each(PUSH_LOCALES)('est complete en %s', (langue) => {
    const T = PUSH[langue];
    expect(Object.keys(T).sort()).toEqual(Object.keys(PUSH.fr).sort());

    // Chaque phrase doit reellement placer ce qu'on lui donne.
    expect(T.memberAdded('Marie')).toContain('Marie');
    expect(T.substepValidated('Marie', 'Coffrage')).toContain('Coffrage');
    expect(T.stepValidated('Marie', 'Fondations')).toContain('Fondations');
    expect(T.documentAdded('Marie', 'Plan.pdf')).toContain('Plan.pdf');
    expect(T.photoAdded('Marie')).toContain('Marie');
    expect(T.emergencyReported('Marie')).toContain('Marie');
    expect(T.claimReported('Marie')).toContain('Marie');
    expect(T.emergencyTitle.trim()).not.toBe('');
    expect(T.claimTitle.trim()).not.toBe('');
    expect(T.feedbackReply.trim()).not.toBe('');
  });

  it.each(PUSH_LOCALES.filter((l) => l !== 'fr'))('le %s est traduit, pas recopie du francais', (langue) => {
    expect(PUSH[langue].photoAdded('Marie')).not.toBe(PUSH.fr.photoAdded('Marie'));
    expect(PUSH[langue].emergencyTitle).not.toBe(PUSH.fr.emergencyTitle);
  });

  it.each(['fr', 'it'] as const)("aucune apostrophe n'a ete perdue en %s", (langue) => {
    const suspect = /(?:(?<!\p{L})(?:d|l|j|n|s|c|t|m|dell|nell|all|dall|sull)|qu)\s+[aeiouhàâäéèêëîïôöùûü]/iu;
    const T = PUSH[langue];
    const textes = [
      T.memberAdded('Marie'),
      T.substepValidated('Marie', 'Coffrage'),
      T.stepValidated('Marie', 'Fondations'),
      T.documentAdded('Marie', 'Plan'),
      T.photoAdded('Marie'),
      T.emergencyReported('Marie'),
      T.claimReported('Marie'),
      T.emergencyTitle,
      T.claimTitle,
      T.feedbackReply,
    ];
    for (const texte of textes) {
      expect(texte, `${langue} : « ${texte} »`).not.toMatch(suspect);
    }
  });

  it("n'accorde pas les verbes polonais au masculin", () => {
    // Le polonais accorde ses participes au genre de la personne. On emploie
    // donc des tournures impersonnelles, sans quoi une cheffe de chantier serait
    // annoncee au masculin a chaque notification.
    const T = PUSH.pl;
    const masculin = /\b(dodał|zatwierdził|zgłosił|złożył)\b/;
    for (const texte of [
      T.memberAdded('Marie'),
      T.substepValidated('Marie', 'Coffrage'),
      T.documentAdded('Marie', 'Plan'),
      T.photoAdded('Marie'),
      T.emergencyReported('Marie'),
      T.claimReported('Marie'),
    ]) {
      expect(texte).not.toMatch(masculin);
    }
  });
});

describe('Composition des notifications', () => {
  it.each(CONSTRUCTEURS)('%s : traduit le corps selon la langue du destinataire', (_nom, construire) => {
    const enFrancais = construire('fr');
    const enTurc = construire('tr');

    expect(enFrancais.body).not.toBe(enTurc.body);
    expect(enFrancais.body).not.toContain('undefined');
    expect(enTurc.body).not.toContain('undefined');
  });

  it.each(CONSTRUCTEURS)('%s : retombe sur le francais pour une langue inconnue', (_nom, construire) => {
    for (const inconnue of ['zz', '', 'FR']) {
      expect(construire(inconnue).body).toBe(construire('fr').body);
    }
  });

  it.each(CONSTRUCTEURS)('%s : nomme le chantier dans le titre', (_nom, construire) => {
    expect(construire('fr').title).toContain('Pont de la Loire');
  });

  it('emmene vers le chantier concerne', () => {
    expect(memberAddedPush({ ...CHANTIER })('fr').data).toMatchObject({ chantier_id: 'c-1' });
    expect(stepValidatedPush({ ...CHANTIER, stepName: 'F', stepId: 'e-1' })('fr').data).toMatchObject({
      type: 'step-validated',
      step_id: 'e-1',
    });
    expect(emergencyPush({ ...CHANTIER, emergencyId: 'u-1', isClaim: false })('fr').data).toMatchObject({
      type: 'emergency',
      emergency_id: 'u-1',
    });
  });

  it('distingue une reclamation d une urgence', () => {
    const urgence = emergencyPush({ ...CHANTIER, emergencyId: 'u-1', isClaim: false })('fr');
    const reclamation = emergencyPush({ ...CHANTIER, emergencyId: 'u-1', isClaim: true })('fr');

    expect(urgence.title).toContain('Urgence');
    expect(reclamation.title).toContain('Réclamation');
    expect(urgence.body).not.toBe(reclamation.body);
  });

  it("tronque un nom de document trop long", () => {
    const push = documentAddedPush({
      ...CHANTIER,
      documentName: 'Plan de masse definitif validé par le bureau d etudes et le maitre d ouvrage.pdf',
    })('fr');

    expect(push.body).toContain('…');
    expect(push.body.length).toBeLessThan(140);
  });

  describe('message de discussion', () => {
    it("n'a rien a traduire : le corps est le message de son auteur", () => {
      const push = commentPush({ ...CHANTIER, content: 'Le beton est coule' });

      expect(push.body).toBe('Marie Dupont : Le beton est coule');
      expect(push.data).toMatchObject({ type: 'comment', chantier_id: 'c-1' });
    });

    it('se distingue selon qu il porte sur une urgence', () => {
      const discussion = commentPush({ ...CHANTIER, content: 'Bonjour' });
      const urgence = commentPush({ ...CHANTIER, content: 'Bonjour', onEmergency: true });

      expect(discussion.title).toContain('💬');
      expect(urgence.title).toContain('🚨');
      expect(urgence.data).toMatchObject({ type: 'emergency-comment' });
    });

    it('tronque un message trop long', () => {
      const push = commentPush({ ...CHANTIER, content: 'a'.repeat(300) });
      expect(push.body).toContain('…');
      expect(push.body.length).toBeLessThan(140);
    });
  });
});

describe('Reponse a un signalement', () => {
  const base = {
    feedbackId: '11111111-1111-1111-1111-111111111111',
    subject: 'La galerie photos reste vide',
    response: 'Corrige dans la version 1.4.1, merci du signalement.',
  };

  it("rappelle l'objet du signalement et le debut de la reponse", () => {
    const push = buildFeedbackReplyPush(base);

    expect(push.body).toContain('La galerie photos');
    expect(push.body).toContain('Corrige dans la version 1.4.1');
  });

  it('emmene vers le signalement concerne', () => {
    expect(buildFeedbackReplyPush(base).data).toEqual({ type: 'feedback', feedback_id: base.feedbackId });
  });

  it.each(PUSH_LOCALES)('est ecrite en %s quand le signalement l etait', (langue) => {
    const push = buildFeedbackReplyPush({ ...base, locale: langue });

    expect(push.title).toContain(PUSH[langue].feedbackReply);
    expect(push.title).not.toContain('undefined');
  });

  it('retombe sur le francais pour une langue inconnue', () => {
    for (const locale of ['zz', '', 'FR', undefined]) {
      expect(buildFeedbackReplyPush({ ...base, locale }).title).toContain(PUSH.fr.feedbackReply);
    }
  });

  it('tronque un objet ou une reponse trop longs', () => {
    const push = buildFeedbackReplyPush({
      ...base,
      subject: 'Un objet de signalement particulierement bavard qui ne tiendra jamais sur un ecran verrouille',
      response: 'Une reponse tout aussi longue, qui detaille le correctif, la version concernee, les contournements possibles et remercie chaleureusement.',
    });

    expect(push.body.length).toBeLessThan(140);
    expect(push.body).toContain('…');
  });
});

describe('Signalement a examiner', () => {
  // Cette notification part aux administrateurs, chacun dans sa langue. Elle ne
  // nomme personne : ni le rapporteur ni la personne visee ne doivent etre lus
  // sur un ecran verrouille. Seul le lieu du signalement y figure.
  const construire = reportPush({ where: 'Pont de la Loire', reportId: 'r-1' });

  it.each(PUSH_LOCALES)('a un titre et un corps en %s', (langue) => {
    expect(PUSH[langue].reportTitle.trim()).not.toBe('');
    expect(PUSH[langue].reportBody('Pont de la Loire')).toContain('Pont de la Loire');

    const push = construire(langue);
    expect(push.title).toContain(PUSH[langue].reportTitle);
    expect(push.body.trim()).not.toBe('');
    expect(push.body).toContain('Pont de la Loire');
    expect(push.body).not.toContain('undefined');
    expect(push.data).toEqual({ type: 'report', report_id: 'r-1' });
  });

  it.each(PUSH_LOCALES.filter((l) => l !== 'fr'))('le %s est traduit, pas recopie du francais', (langue) => {
    expect(PUSH[langue].reportTitle).not.toBe(PUSH.fr.reportTitle);
    expect(construire(langue).body).not.toBe(construire('fr').body);
  });

  it('retombe sur le francais pour une langue inconnue', () => {
    for (const inconnue of ['zz', '', 'FR']) {
      expect(construire(inconnue)).toEqual(construire('fr'));
    }
  });
});
