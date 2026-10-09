import { describe, it, expect } from 'vitest';
import { extractMentionIds, mentionsToText } from '@/lib/mentions';

/**
 * Syntaxe des mentions : « @[Prenom Nom](id) » dans le texte du message.
 *
 * L'identifiant decide qui est prevenu : une erreur de lecture previendrait la
 * mauvaise personne, ou personne.
 */
const PAUL = '8f2c1a4e-3b5d-4c6e-9f70-1a2b3c4d5e6f';
const CLAIRE = '1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b';

describe('Mentions', () => {
  it('trouve chaque personne mentionnee, une seule fois, dans l ordre', () => {
    const texte = `@[Paul Martin](${PAUL}) et @[Claire Durand](${CLAIRE}), puis encore @[Paul](${PAUL})`;
    expect(extractMentionIds(texte)).toEqual([PAUL, CLAIRE]);
  });

  it('ignore ce qui ressemble a une mention sans en etre une', () => {
    expect(extractMentionIds('ecrire a paul@exemple.fr ou @Paul')).toEqual([]);
    expect(extractMentionIds('@[Paul](pas-un-identifiant)')).toEqual([]);
    expect(extractMentionIds('@[Paul\nMartin](' + PAUL + ')')).toEqual([]);
  });

  it('normalise la casse de l identifiant', () => {
    expect(extractMentionIds(`@[Paul](${PAUL.toUpperCase()})`)).toEqual([PAUL]);
  });

  it('se lit comme on l ecrit : « @Prenom Nom »', () => {
    expect(mentionsToText(`@[Paul Martin](${PAUL}) peux-tu passer ?`)).toBe('@Paul Martin peux-tu passer ?');
    expect(mentionsToText('rien a remplacer')).toBe('rien a remplacer');
  });
});
