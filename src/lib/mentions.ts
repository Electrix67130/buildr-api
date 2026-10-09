/**
 * Mentions dans les messages.
 *
 * Une mention s'ecrit dans le texte du message sous la forme
 * « @[Prenom Nom](id) » : le nom garde le message lisible tel quel (dans une
 * notification, un export, une version de l'app qui ne connait pas encore les
 * mentions), l'identifiant dit qui prevenir sans ambiguite entre deux homonymes.
 * Les clients affichent « @Prenom Nom » en couleur.
 */

const MENTION_RE = /@\[([^\]\n]{1,100})\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

/** Les personnes mentionnees, chacune une fois, dans l'ordre du texte. */
export function extractMentionIds(content: string): string[] {
  const ids = new Set<string>();
  for (const match of content.matchAll(MENTION_RE)) ids.add(match[2].toLowerCase());
  return [...ids];
}

/** Le texte tel qu'on le lit : « @Prenom Nom » a la place de chaque mention. */
export function mentionsToText(content: string): string {
  return content.replace(MENTION_RE, (_all, name: string) => `@${name}`);
}
