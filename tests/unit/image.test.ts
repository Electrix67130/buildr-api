import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { optimizeImage, generateThumbnail, isImage, isThumbnailable } from '@/lib/image';

/**
 * Traitement des images a l'upload.
 *
 * Le plus important n'est ni le poids ni les dimensions : c'est le retrait des
 * metadonnees. Une photo de chantier est prise sur place, et son EXIF contient
 * la position GPS, l'appareil et l'horodatage. Ces fichiers sont ensuite servis
 * par une URL signee que n'importe qui peut recevoir — laisser passer l'EXIF
 * reviendrait a diffuser les coordonnees des chantiers.
 */

/** Une image de test, coloree, avec les dimensions demandees. */
function image(width: number, height: number) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } },
  });
}

describe('Reconnaissance des formats', () => {
  it('reconnait une image a son type MIME', () => {
    expect(isImage('image/jpeg')).toBe(true);
    expect(isImage('image/heic')).toBe(true);
    expect(isImage('application/pdf')).toBe(false);
    expect(isImage('text/plain')).toBe(false);
  });

  it('ne promet une miniature que pour les formats qu on sait relire', () => {
    for (const type of ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']) {
      expect(isThumbnailable(type), type).toBe(true);
    }
    for (const type of ['image/heic', 'image/gif', 'application/pdf']) {
      expect(isThumbnailable(type), type).toBe(false);
    }
  });
});

describe('Optimisation des images', () => {
  it('retire les metadonnees EXIF', async () => {
    // Le cas qui compte : la position GPS d'un chantier ne doit pas voyager
    // avec la photo.
    // Les coordonnees GPS vivent dans ce meme bloc EXIF : verifier qu'il
    // disparait entierement les couvre, sans avoir a forger un champ GPS.
    const avec = await image(300, 200)
      .withExif({ IFD0: { Copyright: 'Buildr', Make: 'Apple', Model: 'iPhone 15 Pro' } })
      .jpeg()
      .toBuffer();

    expect((await sharp(avec).metadata()).exif, 'le fichier de depart doit bien porter de l EXIF').toBeTruthy();

    const optimisee = await optimizeImage(avec, 'image/jpeg');

    const meta = await sharp(optimisee).metadata();
    expect(meta.exif).toBeUndefined();
    expect(optimisee.toString('latin1')).not.toContain('iPhone 15 Pro');
    expect(optimisee.toString('latin1')).not.toContain('Buildr');
  });

  it("applique l'orientation EXIF avant de la supprimer", async () => {
    // Sinon les photos prises en mode portrait se retrouvent couchees : le
    // pivotement etait porte par la metadonnee qu'on vient de retirer.
    const couchee = await image(300, 150).withMetadata({ orientation: 6 }).jpeg().toBuffer();

    const optimisee = await optimizeImage(couchee, 'image/jpeg');

    const meta = await sharp(optimisee).metadata();
    // Orientation 6 = rotation d'un quart de tour : les cotes s'echangent.
    expect(meta.width).toBe(150);
    expect(meta.height).toBe(300);
  });

  it('ramene le cote le plus long a 2000 px', async () => {
    const grande = await image(4000, 3000).jpeg().toBuffer();

    const meta = await sharp(await optimizeImage(grande, 'image/jpeg')).metadata();

    expect(meta.width).toBe(2000);
    expect(meta.height).toBe(1500);
  });

  it("n'agrandit jamais une petite image", async () => {
    const petite = await image(320, 240).jpeg().toBuffer();

    const meta = await sharp(await optimizeImage(petite, 'image/jpeg')).metadata();

    expect(meta.width).toBe(320);
    expect(meta.height).toBe(240);
  });

  it('allege reellement une photo de taille courante', async () => {
    // La raison d'etre du traitement : le stockage est facture au Go.
    const photo = await sharp({
      create: { width: 4000, height: 3000, channels: 3, background: { r: 90, g: 140, b: 200 } },
    })
      .jpeg({ quality: 100 })
      .toBuffer();

    const optimisee = await optimizeImage(photo, 'image/jpeg');

    expect(optimisee.length).toBeLessThan(photo.length);
  });

  it.each([
    ['image/jpeg', 'jpeg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
  ])('reemet le format d origine pour %s', async (mimetype, format) => {
    const source = await image(300, 200).toFormat(format as 'jpeg' | 'png' | 'webp').toBuffer();

    const meta = await sharp(await optimizeImage(source, mimetype)).metadata();

    expect(meta.format).toBe(format);
  });

  it('accepte un format plus rare sans le refuser', async () => {
    // Un envoi depuis un chantier ne doit pas echouer parce que le format est
    // inhabituel.
    const gif = await image(200, 200).gif().toBuffer();

    const optimisee = await optimizeImage(gif, 'image/gif');

    expect(optimisee.length).toBeGreaterThan(0);
  });
});

describe('Miniatures', () => {
  it('ramene le cote le plus long a 400 px, en JPEG', async () => {
    const grande = await image(2000, 1000).png().toBuffer();

    const meta = await sharp(await generateThumbnail(grande)).metadata();

    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(200);
  });

  it('pese nettement moins que l originale', async () => {
    const grande = await image(2000, 1500).jpeg({ quality: 100 }).toBuffer();

    const vignette = await generateThumbnail(grande);

    expect(vignette.length).toBeLessThan(grande.length / 2);
  });

  it("n'emporte pas davantage les metadonnees", async () => {
    const avec = await image(800, 600).withExif({ IFD0: { Model: 'iPhone 15 Pro' } }).jpeg().toBuffer();

    const vignette = await generateThumbnail(avec);

    expect((await sharp(vignette).metadata()).exif).toBeUndefined();
  });

  it("n'agrandit pas une image deja petite", async () => {
    const petite = await image(200, 100).jpeg().toBuffer();

    const meta = await sharp(await generateThumbnail(petite)).metadata();

    expect(meta.width).toBe(200);
    expect(meta.height).toBe(100);
  });
});
