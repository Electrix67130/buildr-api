/**
 * Organisation de demonstration pour la review Apple et Google.
 *
 *   npm run seed
 *
 * Cree une organisation « Buildr Démo » avec quatre comptes, trois chantiers
 * remplis (etapes, photos, documents, discussions, urgences) et les fichiers
 * associes deposes dans le stockage configure.
 *
 * Le seed est reexecutable : il supprime d'abord les donnees de l'organisation
 * de demonstration, et uniquement celles-la. Il ne touche jamais aux donnees
 * d'une organisation reelle.
 *
 * Aucune photo reelle : les visuels sont generes et portent la mention
 * « donnees de demonstration ».
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');

const ORG_NAME = 'Buildr Démo';
const DEMO_PASSWORD = 'BuildrDemo2026!';
const ASSETS_DIR = path.join(__dirname, 'assets');

// ---------------------------------------------------------------- stockage

/**
 * Depose un fichier dans le stockage configure et renvoie l'URL a stocker en
 * base. Le seed tourne via le CLI knex, hors du contexte Fastify : il ne peut
 * pas importer src/lib/storage.ts (TypeScript). On reproduit donc ici le strict
 * necessaire, en lisant les memes variables d'environnement.
 */
async function putAsset(fileName, storedName) {
  const body = fs.readFileSync(path.join(ASSETS_DIR, fileName));
  const contentType = fileName.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';

  if (process.env.STORAGE_MODE === 's3') {
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
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
        Bucket: process.env.S3_BUCKET,
        Key: storedName,
        Body: body,
        ContentType: contentType,
      }),
    );
  } else {
    const dir = path.join(__dirname, '..', '..', 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, storedName), body);
  }

  const base = process.env.API_PUBLIC_URL || process.env.APP_URL || 'http://localhost:3000';
  return { url: `${base}/files/${storedName}`, size: body.length, contentType };
}

// ------------------------------------------------------------------ helpers

/** Date relative a maintenant, en jours (negatif = passe). */
function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function isoDate(n) {
  return daysAgo(n).toISOString().slice(0, 10);
}

exports.seed = async function seed(knex) {
  // --- Purge ciblee de l'organisation de demonstration ---------------------
  // Tout est en CASCADE depuis organization : supprimer la ligne suffit a
  // nettoyer chantiers, membres, photos, documents et discussions.
  const existing = await knex('organization').where({ name: ORG_NAME }).first();
  if (existing) {
    // L'ordre compte : chantier.created_by et invitation.invited_by sont en
    // RESTRICT, ils bloquent la suppression des utilisateurs tant qu'ils
    // existent. Et organization.created_by pointe vers un utilisateur, qui lui
    // meme appartient a l'organisation — on casse ce cycle en detachant
    // created_by avant de supprimer l'organisation. Le reste part en cascade
    // (utilisateurs, membres, photos, documents, discussions).
    await knex('invitation').where({ organization_id: existing.id }).del();
    await knex('chantier').where({ organization_id: existing.id }).del();
    await knex('organization').where({ id: existing.id }).update({ created_by: null });
    await knex('organization').where({ id: existing.id }).del();
    console.log('[seed] ancienne organisation de demonstration supprimee');
  }

  // --- Organisation --------------------------------------------------------
  const orgId = crypto.randomUUID();
  await knex('organization').insert({
    id: orgId,
    name: ORG_NAME,
    legal_form: 'SARL',
    siret: '12345678900011',
    naf_code: '4312A',
    address: '12 rue des Compagnons',
    postal_code: '88000',
    city: 'Épinal',
    country: 'FR',
    phone: '03 29 00 00 00',
    billing_email: 'demo@getbuildr.fr',
    insurance_provider: 'Assurance Démo',
    insurance_number: 'DEMO-2026-0001',
  });

  // --- Comptes -------------------------------------------------------------
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const people = [
    { key: 'admin', email: 'demo@getbuildr.fr', first: 'Camille', last: 'Martin', role: 'admin', phone: '06 12 34 56 78' },
    { key: 'manager', email: 'chef@demo.getbuildr.fr', first: 'Thomas', last: 'Lefèvre', role: 'manager', phone: '06 23 45 67 89' },
    { key: 'ouvrier', email: 'ouvrier@demo.getbuildr.fr', first: 'Karim', last: 'Benali', role: 'employee', phone: '06 34 56 78 90' },
    { key: 'client', email: 'client@demo.getbuildr.fr', first: 'Sophie', last: 'Dubois', role: 'client', phone: '06 45 67 89 01' },
  ];

  const users = {};
  for (const p of people) {
    const id = crypto.randomUUID();
    users[p.key] = id;
    await knex('user').insert({
      id,
      email: p.email,
      password_hash: passwordHash,
      first_name: p.first,
      last_name: p.last,
      phone: p.phone,
      role: p.role,
      company_name: ORG_NAME,
      organization_id: orgId,
      active_organization_id: orgId,
      is_active: true,
    });
    await knex('organization_member').insert({
      id: crypto.randomUUID(),
      organization_id: orgId,
      user_id: id,
      role: p.role,
    });
  }

  await knex('organization').where({ id: orgId }).update({ created_by: users.admin });

  // --- Fichiers ------------------------------------------------------------
  // Prefixe fixe : reexecuter le seed ecrase les memes objets au lieu d'en
  // accumuler de nouveaux a chaque passage.
  const assets = {};
  for (const [key, file] of Object.entries({
    terrassement1: 'demo-terrassement-1.jpg',
    terrassement2: 'demo-terrassement-2.jpg',
    vrd1: 'demo-vrd-1.jpg',
    vrd2: 'demo-vrd-2.jpg',
    assainissement1: 'demo-assainissement-1.jpg',
    urgenceReseau: 'demo-urgence-reseau.jpg',
    urgenceFissure: 'demo-urgence-fissure.jpg',
    dict: 'demo-dict.pdf',
    plan: 'demo-plan-masse.pdf',
  })) {
    assets[key] = await putAsset(file, `demo-${file}`);
  }
  console.log(`[seed] ${Object.keys(assets).length} fichiers deposes (${process.env.STORAGE_MODE || 'local'})`);

  // --- Chantiers -----------------------------------------------------------
  const chantiers = [
    {
      key: 'vergnes',
      name: 'Lotissement Les Vergnes — terrassement',
      description: "Terrassement general et fond de forme pour 8 lots. Acces par la rue du Moulin, circulation alternee.",
      address: '3 rue du Moulin',
      city: 'Épinal',
      postal_code: '88000',
      latitude: 48.1722,
      longitude: 6.4498,
      status: 'en_cours',
      start_date: isoDate(24),
      end_date: isoDate(-40),
    },
    {
      key: 'golbey',
      name: 'Zone artisanale de Golbey — VRD',
      description: 'Voirie et reseaux divers sur le lot 3. Coordination avec Enedis pour le raccordement.',
      address: 'Rue de l’Industrie',
      city: 'Golbey',
      postal_code: '88190',
      latitude: 48.2003,
      longitude: 6.4269,
      status: 'en_cours',
      start_date: isoDate(11),
      end_date: isoDate(-60),
    },
    {
      key: 'deyvillers',
      name: 'Rue des Jardins — assainissement',
      description: 'Reprise du collecteur eaux usees sur 120 metres lineaires. Chantier receptionne.',
      address: 'Rue des Jardins',
      city: 'Deyvillers',
      postal_code: '88000',
      latitude: 48.1889,
      longitude: 6.5117,
      status: 'termine',
      start_date: isoDate(95),
      end_date: isoDate(38),
    },
  ];

  const chantierIds = {};
  for (const c of chantiers) {
    const id = crypto.randomUUID();
    chantierIds[c.key] = id;
    const { key, ...row } = c;
    await knex('chantier').insert({
      id,
      ...row,
      organization_id: orgId,
      created_by: users.admin,
      created_at: daysAgo(30),
    });

    // Equipe : le client ne voit que son chantier, sans la partie documents.
    const members = [
      { user_id: users.admin, role: 'manager', can_edit: true },
      { user_id: users.manager, role: 'manager', can_edit: true },
      { user_id: users.ouvrier, role: 'ouvrier', can_edit: false },
    ];
    if (c.key === 'vergnes') {
      members.push({
        user_id: users.client,
        role: 'client',
        can_edit: false,
        can_view_documents: false,
        can_view_team: false,
      });
    }
    for (const m of members) {
      await knex('chantier_member').insert({
        id: crypto.randomUUID(),
        chantier_id: id,
        ...m,
      });
    }
  }

  // --- Etapes et sous-etapes ----------------------------------------------
  const stepPlan = {
    vergnes: [
      ['Installation de chantier', [['Balisage et signalisation', true], ['Base vie', true], ['Constat d’huissier', true]]],
      ['Terrassement', [['Décapage terre végétale', true], ['Déblais en masse', true], ['Fond de forme', false], ['Compactage', false]]],
      ['Réseaux', [['Tranchées eaux pluviales', false], ['Raccordement collecteur', false]]],
    ],
    golbey: [
      ['Préparation', [['DICT et repérage réseaux', true], ['Piquetage', true]]],
      ['Voirie', [['Décaissement', true], ['Grave non traitée', false], ['Bordures', false], ['Enrobés', false]]],
    ],
    deyvillers: [
      ['Travaux', [['Ouverture de tranchée', true], ['Pose collecteur', true], ['Regards de visite', true], ['Remblaiement', true]]],
      ['Réception', [['Essais d’étanchéité', true], ['Inspection télévisée', true], ['PV de réception', true]]],
    ],
  };

  for (const [chantierKey, steps] of Object.entries(stepPlan)) {
    let stepPos = 0;
    for (const [stepName, substeps] of steps) {
      const stepId = crypto.randomUUID();
      await knex('chantier_step').insert({
        id: stepId,
        chantier_id: chantierIds[chantierKey],
        name: stepName,
        position: stepPos++,
      });
      let subPos = 0;
      for (const [subName, done] of substeps) {
        await knex('chantier_substep').insert({
          id: crypto.randomUUID(),
          step_id: stepId,
          name: subName,
          position: subPos++,
          validated_at: done ? daysAgo(5 + subPos) : null,
          validated_by: done ? users.manager : null,
        });
      }
    }
  }

  // --- Photos --------------------------------------------------------------
  const photos = [
    ['vergnes', 'terrassement1', 'Décapage terminé sur la partie nord', users.ouvrier, 6],
    ['vergnes', 'terrassement2', 'Fond de forme en cours de compactage', users.ouvrier, 3],
    ['golbey', 'vrd1', 'Tranchée réseaux secs ouverte', users.manager, 4],
    ['golbey', 'vrd2', 'Première ligne de bordures posée', users.ouvrier, 2],
    ['deyvillers', 'assainissement1', 'Regard de visite posé et calé', users.manager, 42],
  ];
  for (const [chantierKey, assetKey, caption, uploader, ago] of photos) {
    const asset = assets[assetKey];
    await knex('photo').insert({
      id: crypto.randomUUID(),
      chantier_id: chantierIds[chantierKey],
      uploaded_by: uploader,
      url: asset.url,
      caption,
      file_size: asset.size,
      mime_type: asset.contentType,
      taken_at: daysAgo(ago),
      created_at: daysAgo(ago),
    });
  }

  // --- Documents -----------------------------------------------------------
  const documents = [
    ['vergnes', 'dict', 'DICT — Lotissement Les Vergnes.pdf', 'dict'],
    ['golbey', 'plan', 'Plan de masse — lot 3 indice B.pdf', 'plan'],
    ['golbey', 'dict', 'DICT — Zone artisanale.pdf', 'dict'],
  ];
  for (const [chantierKey, assetKey, name, type] of documents) {
    const asset = assets[assetKey];
    await knex('document').insert({
      id: crypto.randomUUID(),
      chantier_id: chantierIds[chantierKey],
      uploaded_by: users.admin,
      name,
      type,
      url: asset.url,
      file_size: asset.size,
      mime_type: asset.contentType,
    });
  }

  // --- Discussions ---------------------------------------------------------
  const comments = [
    ['vergnes', users.manager, 'Terre végétale stockée en fond de parcelle, on la réutilise pour les espaces verts.', 6],
    ['vergnes', users.ouvrier, 'Le compactage du fond de forme est décalé à demain, la pluie a détrempé la zone est.', 2],
    ['vergnes', users.client, 'Merci pour le suivi. Est-ce que le planning de fin de chantier tient toujours ?', 1],
    ['vergnes', users.manager, 'Oui, deux jours de retard absorbés sur la semaine prochaine, la livraison reste tenue.', 1],
    ['golbey', users.manager, 'Enedis passe jeudi pour le raccordement, il faut que la tranchée reste ouverte.', 3],
    ['golbey', users.ouvrier, 'Bordures livrées ce matin, stockées le long du lot 4.', 2],
    ['deyvillers', users.manager, 'Inspection télévisée conforme, PV de réception signé et classé.', 38],
  ];
  for (const [chantierKey, authorId, content, ago] of comments) {
    await knex('comment').insert({
      id: crypto.randomUUID(),
      chantier_id: chantierIds[chantierKey],
      author_id: authorId,
      content,
      created_at: daysAgo(ago),
      updated_at: daysAgo(ago),
    });
  }

  // --- Urgences ------------------------------------------------------------
  const emergencies = [
    {
      chantier: 'golbey',
      asset: 'urgenceReseau',
      description: 'Câble non repéré au DICT découvert à 80 cm sous le trottoir nord. Travaux arrêtés sur la zone, Enedis prévenu.',
      by: users.ouvrier,
      lat: 48.2005,
      lng: 6.4271,
      ago: 3,
      replies: [
        [users.manager, 'Bien reçu, ne touchez à rien. J’ai ouvert un dossier auprès d’Enedis, intervention sous 48 h.', 3],
        [users.admin, 'Constat photo transmis au maître d’ouvrage. On décale le planning enrobés d’une semaine.', 2],
      ],
    },
    {
      chantier: 'vergnes',
      asset: 'urgenceFissure',
      description: 'Fissure apparue sur le mur mitoyen du lot 2 après les déblais. À faire constater avant reprise.',
      by: users.manager,
      lat: 48.1724,
      lng: 6.4501,
      ago: 5,
      replies: [
        [users.admin, 'Huissier contacté, passage prévu vendredi matin. Photos horodatées conservées.', 4],
      ],
    },
  ];

  for (const e of emergencies) {
    const id = crypto.randomUUID();
    await knex('chantier_emergency').insert({
      id,
      chantier_id: chantierIds[e.chantier],
      created_by: e.by,
      photo_url: assets[e.asset].url,
      latitude: e.lat,
      longitude: e.lng,
      description: e.description,
      created_at: daysAgo(e.ago),
    });
    for (const [authorId, content, ago] of e.replies) {
      await knex('emergency_comment').insert({
        id: crypto.randomUUID(),
        emergency_id: id,
        author_id: authorId,
        content,
        created_at: daysAgo(ago),
        updated_at: daysAgo(ago),
      });
    }
  }

  console.log('[seed] organisation de demonstration prete');
  console.log(`[seed]   compte reviewer : demo@getbuildr.fr / ${DEMO_PASSWORD}`);
  console.log('[seed]   3 chantiers, 5 photos, 3 documents, 7 messages, 2 urgences');
};
