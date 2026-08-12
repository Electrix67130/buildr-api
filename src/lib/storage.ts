import fs from 'fs';
import path from 'path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import env from '@/config/env';

/**
 * Stockage des fichiers uploades (photos de chantier, documents).
 *
 * Deux modes, pilotes par STORAGE_MODE :
 * - `local` : disque du serveur (volume Docker). Pratique en dev, mais rien ne
 *   survit a la perte du disque — le dump Postgres ne contient pas les fichiers.
 * - `s3`    : Scaleway Object Storage (compatible S3). Mode retenu en production.
 *
 * Dans les deux cas l'URL stockee en base garde la meme forme,
 * `<API_PUBLIC_URL>/files/<cle>`, et c'est l'API qui reste l'autorite : en mode
 * s3 la route /files redirige vers une URL presignee de courte duree. Changer de
 * mode n'invalide donc aucune ligne existante.
 */

export const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

/** Duree de validite des URLs presignees, alignee sur celle des tokens HMAC. */
const SIGNED_URL_TTL_SECONDS = 5 * 60;

const isS3 = env.STORAGE_MODE === 's3';

if (!isS3 && !fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

let client: S3Client | null = null;

function s3(): S3Client {
  if (!client) {
    if (!env.S3_BUCKET || !env.S3_ACCESS_KEY || !env.S3_SECRET_KEY) {
      throw new Error(
        'STORAGE_MODE=s3 mais S3_BUCKET, S3_ACCESS_KEY ou S3_SECRET_KEY est vide',
      );
    }
    client = new S3Client({
      region: env.S3_REGION,
      // Scaleway, MinIO et consorts exigent un endpoint explicite. Vide => AWS.
      endpoint: env.S3_ENDPOINT || undefined,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY,
      },
    });
  }
  return client;
}

/** Ecrit un fichier et renvoie sa cle de stockage. */
export async function putFile(
  key: string,
  body: Buffer,
  contentType?: string,
): Promise<void> {
  if (isS3) {
    await s3().send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return;
  }
  await fs.promises.writeFile(path.join(UPLOAD_DIR, key), body);
}

/** Indique si le fichier existe, sans le telecharger. */
export async function fileExists(key: string): Promise<boolean> {
  if (isS3) {
    try {
      await s3().send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
  return fs.existsSync(path.join(UPLOAD_DIR, key));
}

/**
 * URL de telechargement directe et temporaire. Null en mode local : le fichier
 * est alors servi par l'API elle-meme.
 */
export async function getDownloadUrl(key: string): Promise<string | null> {
  if (!isS3) return null;
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
    { expiresIn: SIGNED_URL_TTL_SECONDS },
  );
}

/** Supprime un fichier. Sans effet s'il n'existe pas. */
export async function deleteFile(key: string): Promise<void> {
  if (isS3) {
    await s3().send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    return;
  }
  await fs.promises.rm(path.join(UPLOAD_DIR, key), { force: true });
}

export const storageMode = env.STORAGE_MODE;
