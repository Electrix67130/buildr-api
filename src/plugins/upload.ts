import fp from 'fastify-plugin';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID, createHmac } from 'crypto';
import path from 'path';
import { z } from 'zod';
import env from '@/config/env';
import { putFile, fileExists, getDownloadUrl } from '@/lib/storage';
import { isImage, isThumbnailable, optimizeImage, generateThumbnail } from '@/lib/image';

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Generate a signed token: filename + expiry, signed with JWT_SECRET */
function generateFileToken(filename: string): { token: string; expires: number } {
  const expires = Date.now() + TOKEN_TTL_MS;
  const data = `${filename}:${expires}`;
  const signature = createHmac('sha256', env.JWT_SECRET).update(data).digest('hex');
  const token = Buffer.from(JSON.stringify({ f: filename, e: expires, s: signature })).toString('base64url');
  return { token, expires };
}

/** Verify a file token */
function verifyFileToken(token: string, filename: string): boolean {
  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64url').toString());
    if (decoded.f !== filename) return false;
    if (decoded.e < Date.now()) return false;
    const expected = createHmac('sha256', env.JWT_SECRET).update(`${decoded.f}:${decoded.e}`).digest('hex');
    return decoded.s === expected;
  } catch {
    return false;
  }
}

async function uploadPlugin(fastify: FastifyInstance) {
  // GET /files/token/:filename — generate a short-lived signed URL (authenticated)
  fastify.get('/files/token/:filename', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { filename } = z.object({ filename: z.string().min(1) }).parse(request.params);
    const safeName = path.basename(filename);

    if (!(await fileExists(safeName))) {
      return reply.notFound('File not found');
    }

    const { token } = generateFileToken(safeName);
    return { url: `${env.API_PUBLIC_URL}/files/${safeName}?t=${token}` };
  });

  // GET /files/:filename?t=xxx — serve file if token is valid (no API key needed)
  fastify.get('/files/:filename', async (request: FastifyRequest, reply: FastifyReply) => {
    const { filename } = z.object({ filename: z.string().min(1) }).parse(request.params);
    const { t } = z.object({ t: z.string().min(1) }).parse(request.query);

    const safeName = path.basename(filename);

    if (!verifyFileToken(t, safeName)) {
      return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Token expired or invalid' });
    }

    if (!(await fileExists(safeName))) {
      return reply.notFound('File not found');
    }

    // En mode s3, le fichier ne transite pas par l'API : on redirige vers une
    // URL presignee de meme duree de vie que le token.
    const downloadUrl = await getDownloadUrl(safeName);
    if (downloadUrl) {
      return reply.redirect(downloadUrl, 302);
    }

    return reply.sendFile(safeName);
  });

  // POST /upload — upload a file (authenticated)
  fastify.post('/upload', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.badRequest('No file provided');
    }

    const ext = path.extname(data.filename) || '';
    const uuid = randomUUID();
    const storedName = `${uuid}${ext}`;

    // toBuffer() applique la limite de taille de @fastify/multipart (10 Mo) et
    // leve si elle est depassee, la ou le pipe vers un writeStream ecrivait un
    // fichier tronque sans rien signaler.
    const raw = await data.toBuffer();

    // Images : EXIF supprime (les photos de chantier portent la position GPS),
    // redimensionnees et recompressees. Un echec de traitement ne doit pas faire
    // perdre la photo a quelqu'un sur un chantier : on stocke alors l'original.
    let body = raw;
    if (isImage(data.mimetype)) {
      try {
        body = await optimizeImage(raw, data.mimetype);
      } catch (err) {
        request.log.error({ err, mimetype: data.mimetype }, 'optimisation image echouee, original conserve');
      }
    }

    await putFile(storedName, body, data.mimetype);

    // Miniature pour les grilles et les listes. Best-effort : sans elle, les
    // clients retombent sur l'original (`thumbnail_url || url`).
    let thumbnailUrl: string | undefined;
    if (isThumbnailable(data.mimetype)) {
      try {
        const thumbName = `${uuid}_thumb.jpg`;
        await putFile(thumbName, await generateThumbnail(body), 'image/jpeg');
        thumbnailUrl = `${env.API_PUBLIC_URL}/files/${thumbName}`;
      } catch (err) {
        request.log.error({ err }, 'generation de la miniature echouee');
      }
    }

    return reply.code(201).send({
      url: `${env.API_PUBLIC_URL}/files/${storedName}`,
      thumbnail_url: thumbnailUrl,
      original_name: data.filename,
      file_size: body.length,
      mime_type: data.mimetype,
    });
  });
}

export default fp(uploadPlugin, { name: 'upload' });
