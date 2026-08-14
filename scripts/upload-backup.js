/**
 * Depose sur le stockage objet une sauvegarde recue sur l'entree standard.
 *
 *   docker compose -f docker-compose.prod.yml exec -T api \
 *     node scripts/upload-backup.js backups/buildr-2026-08-14.sql.gz < fichier.sql.gz
 *
 * Ce script tourne **dans le conteneur de l'API**, volontairement : le SDK S3 et
 * les identifiants du bucket y sont deja presents. Rien a installer sur l'hote,
 * aucune cle a dupliquer ailleurs.
 *
 * Le fichier arrive par stdin parce que le dump est produit sur l'hote, que le
 * conteneur ne voit pas.
 */

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const key = process.argv[2];
if (!key) {
  console.error('[upload-backup] cle de destination manquante');
  process.exit(1);
}

const bucket = process.env.BACKUP_S3_BUCKET || process.env.S3_BUCKET;
if (!bucket) {
  console.error('[upload-backup] ni BACKUP_S3_BUCKET ni S3_BUCKET renseigne');
  process.exit(1);
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks)));
    process.stdin.on('error', reject);
  });
}

(async () => {
  // Les dumps compresses pesent quelques dizaines de Ko a ce stade ; on les
  // charge en memoire. Si un jour ils atteignent plusieurs centaines de Mo, il
  // faudra passer a un envoi multipart (@aws-sdk/lib-storage).
  const body = await readStdin();
  if (body.length === 0) {
    console.error('[upload-backup] entree vide — rien envoye');
    process.exit(1);
  }

  const client = new S3Client({
    region: process.env.S3_REGION,
    endpoint: process.env.S3_ENDPOINT || undefined,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
    },
  });

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'application/gzip',
    }),
  );

  console.log(`[upload-backup] ${key} envoye (${Math.round(body.length / 1024)} Ko) vers ${bucket}`);
})().catch((err) => {
  console.error('[upload-backup] echec :', err.name, '-', err.message);
  process.exit(1);
});
