import sharp from 'sharp';

/**
 * Traitement des images a l'upload.
 *
 * Trois objectifs, dans cet ordre :
 * - **vie privee** : les photos de chantier sont prises sur place, leurs
 *   metadonnees EXIF contiennent la position GPS, l'appareil et l'horodatage.
 *   Elles sont supprimees avant stockage.
 * - **cout** : le stockage est facture au Go. Une photo de 12 Mpx pesant 5 Mo
 *   descend a quelques centaines de Ko sans perte visible sur un ecran.
 * - **bande passante** : une miniature accompagne chaque image, pour que les
 *   grilles et les listes ne telechargent pas l'original.
 *
 * L'app mobile redimensionne deja avant d'envoyer, mais rien ne le garantit —
 * ni pour les envois depuis le dashboard, ni pour une version plus ancienne de
 * l'app. Le traitement est donc fait cote serveur, ou il s'applique a tout le
 * monde.
 */

/** Cote le plus long apres redimensionnement. */
const MAX_DIMENSION = 2000;
const QUALITY = 80;

/** Cote le plus long d'une miniature (grilles, listes, avatars). */
const THUMBNAIL_DIMENSION = 400;
const THUMBNAIL_QUALITY = 70;

export function isImage(mimetype: string): boolean {
  return mimetype.startsWith('image/');
}

/** Formats pour lesquels on sait produire une miniature. */
export function isThumbnailable(mimetype: string): boolean {
  return ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(mimetype);
}

/**
 * Reoriente selon l'EXIF, supprime les metadonnees, redimensionne sans agrandir
 * et reencode dans le format d'origine.
 *
 * `failOn: 'none'` rend sharp tolerant aux fichiers legerement corrompus :
 * mieux vaut une image reencodee approximativement qu'un upload refuse depuis
 * un chantier.
 */
export async function optimizeImage(input: Buffer, mimetype: string): Promise<Buffer> {
  const pipeline = sharp(input, { failOn: 'none' })
    // .rotate() sans argument applique l'orientation EXIF puis la retire ;
    // sans lui, retirer les metadonnees ferait pivoter les photos prises en
    // mode portrait.
    .rotate()
    .resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    });

  switch (mimetype) {
    case 'image/jpeg':
    case 'image/jpg':
      return pipeline.jpeg({ quality: QUALITY, mozjpeg: true }).toBuffer();
    case 'image/png':
      return pipeline.png({ compressionLevel: 9 }).toBuffer();
    case 'image/webp':
      return pipeline.webp({ quality: QUALITY }).toBuffer();
    default:
      // Formats plus rares (gif, avif, tiff...) : on laisse sharp reemettre le
      // format d'origine, sans options specifiques.
      return pipeline.toBuffer();
  }
}

/** Miniature JPEG (~400 px) derivee d'une image deja optimisee. */
export async function generateThumbnail(input: Buffer): Promise<Buffer> {
  return sharp(input, { failOn: 'none' })
    .rotate()
    .resize({
      width: THUMBNAIL_DIMENSION,
      height: THUMBNAIL_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: THUMBNAIL_QUALITY, mozjpeg: true })
    .toBuffer();
}
