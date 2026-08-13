import { createHmac } from 'crypto';
import env from '@/config/env';

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Generate a signed URL for a file path like /files/abc-123.pdf */
export function signFileUrl(fileUrl: string): string {
  const filename = fileUrl.split('/').pop();
  if (!filename) return fileUrl;

  const expires = Date.now() + TOKEN_TTL_MS;
  const data = `${filename}:${expires}`;
  const signature = createHmac('sha256', env.JWT_SECRET).update(data).digest('hex');
  const token = Buffer.from(JSON.stringify({ f: filename, e: expires, s: signature })).toString('base64url');

  return `${env.API_PUBLIC_URL}/files/${filename}?t=${token}`;
}

/**
 * Signe les URLs de fichiers presentes dans une liste d'objets.
 *
 * On ne se fie pas au nom des champs : toute valeur pointant vers /files/ est
 * signee, quel que soit son nom. La version precedente ne traitait que `url` et
 * `thumbnail_url`, ce qui laissait passer `photo_url` (urgences), `avatar_url`
 * (utilisateurs) et `logo_url` (organisations) — leurs images partaient sans
 * token et le client se prenait un 403, sans autre symptome qu'une vignette
 * noire.
 *
 * `fields` permet de restreindre explicitement le champ d'application si
 * besoin ; par defaut on inspecte toutes les valeurs de type chaine.
 */
export function signUrlsInList<T extends Record<string, unknown>>(items: T[], fields?: string[]): T[] {
  return items.map((item) => {
    const signed = { ...item };
    for (const field of fields ?? Object.keys(signed)) {
      const val = signed[field];
      if (typeof val === 'string' && val.includes('/files/')) {
        (signed as Record<string, unknown>)[field] = signFileUrl(val);
      }
    }
    return signed;
  });
}

/** Variante pour un objet seul. */
export function signUrlsIn<T extends Record<string, unknown>>(item: T, fields?: string[]): T {
  return signUrlsInList([item], fields)[0];
}
