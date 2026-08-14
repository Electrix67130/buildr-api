# Buildr API — Reference des endpoints

Base URL : `http://localhost:3000`
Headers requis : `x-api-key: <API_KEY>`

## Pagination (tous les GET list)

Query params :
- `page` (defaut: 1, min: 1)
- `limit` (defaut: 20, min: 1, max: 100)
- `orderBy` (defaut: `created_at`)
- `order` (defaut: `desc`, options: `asc`/`desc`)

Reponse paginee :
```json
{
  "data": [...],
  "meta": { "total": 50, "page": 1, "limit": 20, "totalPages": 3 }
}
```

---

## Health

| Methode | Route | Auth | Description |
|---|---|---|---|
| GET | `/health` | Non | Verification de l'etat de l'API |

**Reponse :** `{ "status": "ok" }`

---

## Auth

| Methode | Route | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | Non | Creer un compte |
| POST | `/auth/login` | Non | Connexion |
| POST | `/auth/refresh` | Non | Renouveler le token |
| POST | `/auth/logout` | JWT | Deconnexion |
| POST | `/auth/forgot-password` | Non | Demander un reset de mot de passe |
| POST | `/auth/reset-password` | Non | Reinitialiser le mot de passe via token |
| GET | `/auth/me` | JWT | Profil utilisateur connecte |

### POST /auth/register

**Body :**
```json
{
  "email": "string (required)",
  "password": "string min 8 (required)",
  "first_name": "string (required)",
  "last_name": "string (required)",
  "phone": "string (optional)",
  "role": "admin | employee | client (default: employee)",
  "company_name": "string (optional)"
}
```

**Reponse 201 :**
```json
{
  "user": { "id", "email", "first_name", "last_name", "role", ... },
  "access_token": "jwt",
  "refresh_token": "uuid"
}
```

### POST /auth/login

**Body :** `{ "email": "string", "password": "string", "platform": "mobile" | "web" (optionnel, defaut "web") }`

**Reponse 200 :** meme format que register

**Sessions par plateforme** — chaque plateforme garde sa propre session active.
Se connecter sur le mobile n'invalide que la precedente session mobile ; le
dashboard reste ouvert, et inversement. Une seconde connexion sur la MEME
plateforme invalide la premiere (token rejete avec un 401 « Session expired
(logged in elsewhere on this device type) », et WebSocket ferme avec le code
4001).

`/auth/logout` ne coupe egalement que la session de la plateforme d'ou provient
le token. Les tokens emis avant l'introduction du claim `platform` restent
acceptes sans controle de session, jusqu'a la prochaine connexion.

### POST /auth/refresh

**Body :** `{ "refresh_token": "string" }`

**Reponse 200 :** `{ "access_token": "jwt", "refresh_token": "uuid" }`

### POST /auth/forgot-password

**Body :** `{ "email": "string" }`

**Reponse 200 :** `{ "message": "If an account exists with this email, a reset link has been sent." }`

### POST /auth/reset-password

**Body :** `{ "token": "string", "new_password": "string min 8" }`

**Reponse 200 :** `{ "message": "Password has been reset successfully" }`

### POST /auth/logout

**Reponse 204** (no content)

### GET /auth/me

**Reponse 200 :** objet user (sans password_hash)

---

## Users

| Methode | Route | Auth | Description |
|---|---|---|---|
| GET | `/users` | JWT | Liste paginee (scopee par role — voir ci-dessous) |
| GET | `/users/:id` | JWT | Detail |
| GET | `/users/search?q=xxx` | JWT | Recherche par nom/email/entreprise |
| POST | `/users` | JWT | Creer |
| PATCH | `/users/:id` | JWT | Modifier |
| DELETE | `/users/me` | JWT | Supprimer son propre compte (voir ci-dessous) |
| DELETE | `/users/:id` | JWT | Supprimer (admin uniquement) |

### DELETE /users/me — Suppression de son compte

Exige par l'App Store (guideline 5.1.1(v)) : toute app permettant la creation de compte
doit permettre sa suppression depuis l'app.

**Body** : `{ "password": "..." }` — le mot de passe est redemande pour qu'un token vole
ne suffise pas a detruire un compte.

**Reponses**
| Code | Cas |
|---|---|
| 204 | Compte supprime |
| 401 | Mot de passe incorrect |
| 404 | Compte inexistant ou deja supprime |
| 409 | L'utilisateur est le dernier admin d'une organisation qui compte encore des membres |

**Comportement** — la ligne `user` n'est pas supprimee physiquement : plusieurs FK sont en
RESTRICT (`chantier.created_by`, `invitation.invited_by`, `organization.created_by`), un
DELETE echouerait des que l'utilisateur a cree un chantier. Elle est **anonymisee** :
`email` neutralise, `first_name`/`last_name` remplaces, `phone`/`avatar_url`/`company_name`
vides, `password_hash` rendu invalide, `is_active` a false, `deleted_at` horodate.

Sont **supprimes** : `refresh_token`, `push_token`, `calendar_integration`,
`organization_member`, `chantier_member`, `chantier_template_member`, `team_member`.

Sont **conserves** : chantiers, photos, documents et messages crees — ils appartiennent a
l'organisation et apparaissent desormais sous « Compte supprime ».

### GET /users — Visibilite

- **Admin** : voit tous les utilisateurs de l'organisation
- **Manager / Employee / Client** : voit uniquement les co-membres de ses chantiers

### Roles globaux

| Role | Creer chantier | Inviter | Gerer equipe chantier | Modifier permissions | Voir tous les users |
|---|---|---|---|---|---|
| `admin` | oui | oui | oui | oui | oui |
| `manager` | non | non | oui (ses chantiers) | non | non (co-membres) |
| `employee` | non | non | non | non | non (co-membres) |
| `client` | non | non | non | non | non (co-membres) |

### GET /users/search

**Query :** `q` (string, min 1), `page`, `limit`

**Reponse 200 :** liste paginee d'utilisateurs (sans password_hash)

---

## Chantiers

| Methode | Route | Auth | Description |
|---|---|---|---|
| GET | `/chantiers` | JWT | Liste active (non archivee), filtrable par status |
| GET | `/chantiers/:id` | JWT | Detail |
| GET | `/chantiers/search` | JWT | Recherche par mot-cle et/ou GPS |
| GET | `/chantiers/archives` | JWT | Liste des chantiers archives |
| POST | `/chantiers` | JWT | Creer un chantier |
| PATCH | `/chantiers/:id` | JWT | Modifier |
| DELETE | `/chantiers/:id` | JWT | Supprimer |
| POST | `/chantiers/:id/archive` | JWT | Archiver |
| POST | `/chantiers/:id/unarchive` | JWT | Desarchiver |
| PATCH | `/chantiers/:id/retention` | JWT (admin) | Modifier la duree de conservation d'un chantier archive |

### GET /chantiers

**Query :** `status` (a_venir | en_cours | termine), `page`, `limit`, `orderBy`, `order`

**Reponse 200 :** liste paginee de chantiers actifs (non archives)

### GET /chantiers/search

**Query :**
- `q` (string, recherche nom/adresse/ville/code postal/description)
- `lat`, `lng` (coordonnees GPS, rayon de recherche)
- `radius_km` (defaut: 50, max: 500)
- `status` (filtre optionnel)
- `page`, `limit`

**Reponse 200 :** liste paginee, triee par distance si GPS fourni (+ champ `distance_km`)

### POST /chantiers

**Body :**
```json
{
  "name": "string (required)",
  "description": "string (optional)",
  "address": "string (optional)",
  "city": "string (optional)",
  "postal_code": "string (optional)",
  "latitude": "number (optional)",
  "longitude": "number (optional)",
  "status": "a_venir | en_cours | termine (default: a_venir)",
  "start_date": "date string (optional)",
  "end_date": "date string (optional)"
}
```

**Reponse 201 :** objet chantier cree (created_by = utilisateur connecte)

### POST /chantiers/:id/archive

**Reponse 200 :** chantier archive (archived_at + auto_delete_at = archived_at + `archive_retention_years` de l'organisation)

### POST /chantiers/:id/unarchive

**Reponse 200 :** chantier desarchive (archived_at et auto_delete_at remis a null)

### PATCH /chantiers/:id/retention

**Auth :** admin uniquement. Le chantier doit etre archive.

**Body :**
```json
{ "years": 1 }
```

`years` : entier entre 1 et 10. `auto_delete_at` est recalcule = `archived_at + years`.

**Reponse 200 :** chantier archive avec nouveau `auto_delete_at`.

---

## Chantier Steps

Etapes (et sous-etapes a checkbox) attachees a un chantier. Permissions :

- **Manage** (create/edit/delete/reorder) : admin OR createur du chantier OR membre de role `manager` OR membre avec `can_edit=true`
- **Toggle validation** : tout membre du chantier *sauf* role `client` (admin et createur autorises)
- **View** : tout membre + createur + admin

| Methode | Route | Auth | Description |
|---|---|---|---|
| GET | `/chantiers/:chantier_id/steps` | JWT | Liste les etapes avec sous-etapes nestees, ordonnees par `position` |
| POST | `/chantier-steps` | JWT | Cree une etape `{chantier_id, name}` |
| PATCH | `/chantier-steps/:id` | JWT | Renomme `{name}` |
| DELETE | `/chantier-steps/:id` | JWT | Supprime (cascade les sous-etapes) |
| POST | `/chantiers/:chantier_id/steps/reorder` | JWT | Reorder bulk `{ordered_ids: [uuid, ...]}` |
| POST | `/chantier-substeps` | JWT | Cree une sous-etape `{step_id, name}` |
| PATCH | `/chantier-substeps/:id` | JWT | Modifie `{name?, validation_comment?}` |
| DELETE | `/chantier-substeps/:id` | JWT | Supprime |
| POST | `/chantier-steps/:id/substeps/reorder` | JWT | Reorder bulk des sous-etapes |
| POST | `/chantier-substeps/:id/toggle` | JWT | Valide/invalide `{validated: bool, validation_comment?: string\|null}`. Si `validated=true`, set `validated_at` + `validated_by` au user courant. Si `validated=false`, les remet a NULL. |
| POST | `/chantier-steps/:id/toggle` | JWT | Valide/invalide une étape entiere (meme schema et meme regle de droits que substep toggle). Etat **independant** des sous-etapes : valider l'étape ne coche pas les sous-etapes en cascade. |

### Reponse de `GET /chantiers/:chantier_id/steps`

```json
[
  {
    "id": "uuid",
    "chantier_id": "uuid",
    "name": "Gros oeuvre",
    "position": 0,
    "substeps": [
      { "id": "uuid", "step_id": "uuid", "name": "Fondations", "position": 0, "validated_at": "2026-04-28T...", "validated_by": "uuid", "validation_comment": "OK avec equipe d'Ahmed", "created_at": "...", "updated_at": "..." },
      { "id": "uuid", "step_id": "uuid", "name": "Murs porteurs", "position": 1, "validated_at": null, "validated_by": null, "validation_comment": null, "created_at": "...", "updated_at": "..." }
    ],
    "created_at": "...",
    "updated_at": "..."
  }
]
```

---

## Chantier Members

| Methode | Route | Auth | Description |
|---|---|---|---|
| GET | `/chantier-members` | JWT | Liste paginee |
| GET | `/chantier-members/:id` | JWT | Detail |
| GET | `/chantier-members/by-chantier?chantier_id=xxx` | JWT | Membres d'un chantier (avec infos user) |
| POST | `/chantier-members` | JWT | Ajouter un membre |
| PATCH | `/chantier-members/:id` | JWT | Modifier role/permissions |
| DELETE | `/chantier-members/:id` | JWT | Retirer un membre |

### POST /chantier-members

**Body :**
```json
{
  "chantier_id": "uuid (required)",
  "user_id": "uuid (required)",
  "role": "responsable | ouvrier | client (default: ouvrier)",
  "can_view_comments": "boolean (default: true)",
  "can_view_photos": "boolean (default: true)",
  "can_view_documents": "boolean (default: true)",
  "can_edit": "boolean (default: false)"
}
```

---

## Invitations

| Methode | Route | Auth | Description |
|---|---|---|---|
| GET | `/invitations` | JWT | Liste des invitations |
| POST | `/invitations` | JWT | Inviter un collaborateur |
| POST | `/invitations/:token/accept` | Non | Accepter une invitation |
| DELETE | `/invitations/:id` | JWT | Annuler une invitation |

### POST /invitations

**Body :** `{ "email": "string", "role": "admin | employee | client" }`

**Reponse 201 :** invitation avec token (expire dans 7 jours)

---

## Comments

| Methode | Route | Auth | Description |
|---|---|---|---|
| GET | `/comments?chantier_id=xxx` | JWT | Commentaires d'un chantier (avec auteur) |
| GET | `/comments/:id` | JWT | Detail |
| POST | `/comments` | JWT | Ajouter un commentaire |
| PATCH | `/comments/:id` | JWT | Modifier |
| DELETE | `/comments/:id` | JWT | Supprimer |

### POST /comments

**Body :** `{ "chantier_id": "uuid", "content": "string" }`

**Reponse 201 :** commentaire cree (author_id = utilisateur connecte)

---

## Signalements d'erreur

| Methode | Route | Auth | Description |
|---|---|---|---|
| POST | `/error-reports` | cle d'API seule | Remonte un plantage client dans `error_log` |

**Body :**
```json
{
  "level": "error | warn (defaut error)",
  "message": "string (requis, max 2000)",
  "stack": "string (optionnel, max 10000)",
  "source": "mobile | dashboard (requis)",
  "platform": "ios | android | web (optionnel)",
  "app_version": "string (optionnel, max 40)",
  "screen": "string (optionnel, max 200)"
}
```

**Reponse 202** (accepte, corps vide).

**Sans JWT obligatoire** : un plantage se produit aussi sur l'ecran de connexion,
et c'est celui-la qu'on veut le moins rater. Si un token valide accompagne la
requete, l'erreur est rattachee a l'utilisateur ; sinon elle reste anonyme.

Limite a **20 requetes par minute** et par IP, en plus de la limite globale : une
boucle de plantage cote client inonderait sinon la table. Les longueurs sont
plafonnees pour la meme raison — la cle d'API est publique, puisqu'embarquee dans
le bundle mobile.

Les signalements remontent dans la page `/admin/errors` du dashboard, aux cotes
des erreurs 500 de l'API (`source: "api"`).

---

## Fichiers (photos et documents)

| Methode | Route | Auth | Description |
|---|---|---|---|
| POST | `/upload` | JWT | Envoie un fichier, renvoie son URL permanente |
| GET | `/files/token/:filename` | JWT | Regenere une URL signee pour un fichier |
| GET | `/files/:filename?t=xxx` | token signe | Telecharge le fichier |

### POST /upload

Multipart, champ fichier unique, **10 Mo maximum**. Au-dela, la requete est
rejetee — le fichier n'est jamais ecrit tronque.

**Reponse 201 :**
```json
{
  "url": "https://api.getbuildr.fr/files/<uuid>.jpg",
  "original_name": "photo.jpg",
  "file_size": 412903,
  "mime_type": "image/jpeg"
}
```

L'`url` renvoyee est **permanente** : c'est elle qu'on stocke en base
(`photo.url`, `document.url`, `chantier_emergency.photo_url`). Elle n'est pas
telechargeable directement.

### Acces aux fichiers

Les routes de liste (`/photos`, `/documents`, `/emergencies`) reecrivent les
URLs stockees en **URLs signees valables 5 minutes**, via un token HMAC. Un
client qui garde une URL en cache doit la regenerer avec
`GET /files/token/:filename` une fois le delai passe.

`/files/:filename` est la seule famille de routes accessible **sans cle d'API** :
le token signe fait foi. Cela permet de l'utiliser directement dans une balise
image.

**Stockage** — pilote par `STORAGE_MODE` :
- `local` : disque du serveur, le fichier est servi par l'API ;
- `s3` : Scaleway Object Storage, l'API repond `302` vers une URL presignee de
  meme duree de vie.

Le format de l'URL stockee est identique dans les deux modes : changer de mode
n'invalide aucune ligne existante.

---

## Photos

| Methode | Route | Auth | Description |
|---|---|---|---|
| GET | `/photos?chantier_id=xxx` | JWT | Photos d'un chantier (avec auteur) |
| GET | `/photos/:id` | JWT | Detail |
| POST | `/photos` | JWT | Ajouter une photo |
| DELETE | `/photos/:id` | JWT | Supprimer |

### POST /photos

**Body :**
```json
{
  "chantier_id": "uuid (required)",
  "url": "string url (required)",
  "thumbnail_url": "string url (optional)",
  "caption": "string (optional)",
  "latitude": "number (optional)",
  "longitude": "number (optional)",
  "taken_at": "timestamp (optional)",
  "file_size": "integer (optional)",
  "mime_type": "string (optional)"
}
```

---

## Photo Comments

| Methode | Route | Auth | Description |
|---|---|---|---|
| GET | `/photo-comments?photo_id=xxx` | JWT | Commentaires d'une photo |
| POST | `/photo-comments` | JWT | Ajouter |
| DELETE | `/photo-comments/:id` | JWT | Supprimer |

### POST /photo-comments

**Body :** `{ "photo_id": "uuid", "content": "string" }`

---

## Chantier Templates

Modeles de chantier (etapes/sous-etapes + equipe pre-remplies). Visibles par les membres de l'organisation. Creation/modification/suppression : admin ou manager. Utilisation (`/use`) : admin uniquement.

| Methode | Route | Auth | Description |
|---|---|---|---|
| GET | `/chantier-templates` | JWT | Liste des modeles de l'organisation |
| GET | `/chantier-templates/:id` | JWT | Detail (avec etapes + membres) |
| POST | `/chantier-templates` | JWT (admin/manager) | Creer |
| PATCH | `/chantier-templates/:id` | JWT (admin/manager) | Modifier (replace etapes/membres si fournis) |
| DELETE | `/chantier-templates/:id` | JWT (admin/manager) | Supprimer |
| POST | `/chantier-templates/:id/use` | JWT (admin) | Creer un chantier a partir du modele |

### POST /chantier-templates / PATCH /chantier-templates/:id

**Body :**
```json
{
  "name": "string (required on POST)",
  "description": "string (optional)",
  "default_status": "a_venir | en_cours | termine (optional, default a_venir)",
  "steps": [
    { "name": "string", "substeps": [{ "name": "string" }] }
  ],
  "members": [{ "user_id": "uuid" }]
}
```

Les `members` sont filtres cote serveur : memes organisation et roles globaux `admin`/`manager`/`employee` uniquement (clients et gestionnaire_reseau exclus).

### POST /chantier-templates/:id/use

**Body :** mêmes champs que `POST /chantiers` (name requis, dates optionnelles, etc.).

Le chantier cree herite des etapes/sous-etapes du modele, et les membres du modele sont inseres dans `chantier_member` avec le mapping :
- global `admin` ou `manager` -> chantier role `responsable`
- global `employee` -> chantier role `ouvrier`

---

## Emergencies / Reclamations

Urgences (manager / ouvrier / admin / createur) ou reclamations (client). Stockees dans la meme table `chantier_emergency`.

| Methode | Route | Auth | Description |
|---|---|---|---|
| GET | `/emergencies?chantier_id=xxx` | JWT | Liste des urgences d'un chantier (membres + admin + createur) |
| POST | `/emergencies` | JWT | Creer (admin / createur / manager / ouvrier / client). Le `gestionnaire_reseau` est exclu. |
| DELETE | `/emergencies/:id` | JWT | Auteur / admin / createur / manager du chantier |

### POST /emergencies

**Body :**
```json
{
  "chantier_id": "uuid (required)",
  "photo_url": "string url (optional)",
  "thumbnail_url": "string url (optional)",
  "latitude": "number (optional)",
  "longitude": "number (optional)",
  "description": "string (optional)"
}
```

---

## Emergency Comments

Discussion attachee a une urgence. Tous les membres autorises a voir l'urgence peuvent ecrire (employes/manager/admin d'un cote, gestionnaire_reseau de l'autre cote).

| Methode | Route | Auth | Description |
|---|---|---|---|
| GET | `/emergency-comments?emergency_id=xxx` | JWT | Commentaires d'une urgence (ordre chronologique) |
| POST | `/emergency-comments` | JWT | Ajouter un commentaire |
| DELETE | `/emergency-comments/:id` | JWT | Supprimer (admin via le service) |

### POST /emergency-comments

**Body :** `{ "emergency_id": "uuid", "content": "string (1..2000)" }`

**Reponse GET** : chaque item inclut `first_name`, `last_name`, `role` de l'auteur (utile pour positionner le bubble cote interne ou cote gestionnaire_reseau).

---

## Documents

| Methode | Route | Auth | Description |
|---|---|---|---|
| GET | `/documents?chantier_id=xxx&type=xxx` | JWT | Documents d'un chantier (filtrable par type) |
| GET | `/documents/:id` | JWT | Detail |
| POST | `/documents` | JWT | Ajouter |
| DELETE | `/documents/:id` | JWT | Supprimer |

### POST /documents

**Body :**
```json
{
  "chantier_id": "uuid (required)",
  "name": "string (required)",
  "type": "dict | dt | bon_de_commande | plan | arrete | facture | autre (required)",
  "url": "string url (required)",
  "file_size": "integer (optional)",
  "mime_type": "string (optional)"
}
```

Types de documents :
- `dict` : Declaration d'Intention de Commencement de Travaux
- `dt` : Declaration de Travaux
- `bon_de_commande` : Bon de commande
- `plan` : Plans
- `arrete` : Arrete
- `facture` : Facture
- `autre` : Autre

---

## Calendar Integrations

Synchronise les dates des chantiers (membre ou createur, non archives) avec les calendriers externes de l'utilisateur.

| Methode | Route | Auth | Description |
|---|---|---|---|
| GET | `/calendar/integrations` | JWT | Liste les integrations connectees pour l'utilisateur courant |
| POST | `/calendar/oauth/:provider/start` | JWT | Demarre le flow OAuth (`google` ou `outlook`), retourne `auth_url` |
| GET | `/calendar/oauth/:provider/callback` | Aucune | Redirect URI OAuth (Google/Outlook). Echange le code contre un refresh_token, redirige vers `buildr://calendar-callback?provider=...&status=ok|error` |
| POST | `/calendar/apple/connect` | JWT | Genere (ou recupere) l'URL d'abonnement iCal pour Apple Calendar |
| DELETE | `/calendar/integrations/:provider` | JWT | Deconnecte une integration (`google`, `outlook`, `apple`) |
| GET | `/calendar/ical/:token.ics` | Aucune | Flux iCal public (subscribe URL) — un VEVENT par chantier date_debut → date_fin |

### Flow OAuth (Google / Outlook)

1. Le client appelle `POST /calendar/oauth/google/start` (JWT). Reponse : `{ "auth_url": "https://accounts.google.com/..." }`
2. Le client ouvre `auth_url` (ex. `WebBrowser.openAuthSessionAsync` cote Expo) avec `redirectUrl=buildr://calendar-callback`
3. L'utilisateur consent, Google/Outlook redirige vers `${CALENDAR_OAUTH_REDIRECT_BASE}/calendar/oauth/google/callback?code=...&state=...`
4. L'API echange le code, stocke le `refresh_token` chiffre (AES-256-GCM via `CALENDAR_ENCRYPTION_KEY`), puis redirige vers `buildr://calendar-callback?provider=google&status=ok`
5. Au retour dans l'app, on relance `GET /calendar/integrations` pour voir l'etat
6. Au moment du connect, un back-fill push tous les chantiers actifs de l'utilisateur

### Flow Apple

`POST /calendar/apple/connect` retourne `{ "ical_url": "${CALENDAR_OAUTH_REDIRECT_BASE}/calendar/ical/<token>.ics" }`. L'utilisateur la colle dans Calendrier (macOS : Fichier → Nouvel abonnement à un calendrier ; iOS : Reglages → Calendrier → Comptes → Calendrier avec abonnement).

### Synchronisation automatique

Les events sont pousses/maj/supprimes (Google + Outlook) et le flux iCal regenerera (Apple) sur :

- `POST /chantiers` : push pour le createur + manager assigne
- `PATCH /chantiers/:id` : si `start_date`, `end_date`, `name`, `description`, `address`, `city`, ou `postal_code` change → maj pour tous les membres + createur
- `DELETE /chantiers/:id` : suppression pour tous les membres
- `POST /chantiers/:id/archive` : suppression (chantier archive disparait du calendrier)
- `POST /chantiers/:id/unarchive` : recreation
- `POST /chantier-members` : push du chantier pour le nouveau membre
- `DELETE /chantier-members/:id` : suppression du chantier pour le membre retire

Tous ces hooks sont **non bloquants** (`setImmediate` + try/catch loggue) — la requete HTTP rend immediatement, la sync se fait en tache de fond.

---

## Push Notifications

Enregistrement des tokens Expo Push par device et toggle global ON/OFF par user. Les pushs sont envoyes en fire-and-forget sur les evenements chantier (commentaire, photo, document, urgence, ajout d'un membre, validation d'etape, etc.).

| Methode | Route | Auth | Body | Description |
|---|---|---|---|---|
| POST | `/push-tokens` | JWT | `{ token, platform? }` | Enregistre / re-attribue un token Expo pour le device courant. `platform` ∈ `'ios' \| 'android' \| 'web'`. Si le token existe deja sur un autre user, il est reaffecte au user courant (ON CONFLICT(token) DO MERGE). 204. |
| DELETE | `/push-tokens` | JWT | `{ token }` | Supprime un token (au logout, ou desinstallation). 204. |
| PATCH | `/push-tokens/preference` | JWT | `{ enabled: boolean }` | Active/desactive globalement les pushs pour le user (set `user.push_enabled`). Reponse : `{ push_enabled }`. |

Quand `user.push_enabled = false`, l'envoi est skip pour cet user dans `sendPushToUsers`. Les tokens dont Expo retourne `DeviceNotRegistered` sont automatiquement nettoyes en BDD.
