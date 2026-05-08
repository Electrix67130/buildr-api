# Buildr — Schema de la base de donnees (MCD)

Base de donnees : PostgreSQL 17
ORM : Knex 3

## Conventions

- Toutes les tables utilisent un `id` UUID comme cle primaire (`defaultTo(knex.fn.uuid())`)
- Toutes les tables ont `created_at` et `updated_at` (timestamps, NOT NULL, default now)
- Les FK utilisent `ON DELETE CASCADE` sauf mention contraire
- Les enums sont crees via PostgreSQL natif (`CREATE TYPE`)

---

## Table : `user`

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK, default uuid |
| `email` | varchar(255) | NOT NULL, UNIQUE |
| `password_hash` | varchar(255) | NOT NULL |
| `first_name` | varchar(100) | NOT NULL |
| `last_name` | varchar(100) | NOT NULL |
| `phone` | varchar(20) | nullable |
| `avatar_url` | varchar(500) | nullable |
| `role` | enum `user_role` (`admin`, `manager`, `employee`, `client`) | NOT NULL, default `employee` |
| `company_name` | varchar(200) | nullable |
| `is_active` | boolean | NOT NULL, default true |
| `created_at` | timestamp | NOT NULL, default now |
| `updated_at` | timestamp | NOT NULL, default now |

**Migration :** `20260412120000_create_user.js`

---

## Table : `refresh_token`

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK, default uuid |
| `user_id` | uuid | NOT NULL, FK -> `user.id` CASCADE |
| `token` | text | NOT NULL, UNIQUE |
| `created_at` | timestamp | NOT NULL, default now |

**Migration :** `20260412120001_create_refresh_token.js`

---

## Table : `chantier`

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK, default uuid |
| `name` | varchar(200) | NOT NULL |
| `description` | text | nullable |
| `address` | varchar(500) | nullable |
| `city` | varchar(100) | nullable |
| `postal_code` | varchar(10) | nullable |
| `latitude` | decimal(10,7) | nullable |
| `longitude` | decimal(10,7) | nullable |
| `status` | enum `chantier_status` (`a_venir`, `en_cours`, `termine`) | NOT NULL, default `a_venir` |
| `start_date` | date | nullable |
| `end_date` | date | nullable |
| `created_by` | uuid | NOT NULL, FK -> `user.id` (pas CASCADE) |
| `archived_at` | timestamp | nullable |
| `auto_delete_at` | timestamp | nullable (archived_at + `organization.archive_retention_years`, modifiable par chantier via `PATCH /chantiers/:id/retention`) |
| `created_at` | timestamp | NOT NULL, default now |
| `updated_at` | timestamp | NOT NULL, default now |

**Index :** `idx_chantier_status` (status), `idx_chantier_coords` (latitude, longitude)

**Migration :** `20260412120002_create_chantier.js`

---

## Table : `chantier_member`

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK, default uuid |
| `chantier_id` | uuid | NOT NULL, FK -> `chantier.id` CASCADE |
| `user_id` | uuid | NOT NULL, FK -> `user.id` CASCADE |
| `role` | enum `chantier_member_role` (`manager`, `ouvrier`, `client`) | NOT NULL, default `ouvrier` |
| `can_view_comments` | boolean | NOT NULL, default true |
| `can_view_photos` | boolean | NOT NULL, default true |
| `can_view_documents` | boolean | NOT NULL, default true |
| `can_edit` | boolean | NOT NULL, default false |
| `created_at` | timestamp | NOT NULL, default now |
| `updated_at` | timestamp | NOT NULL, default now |

**Contrainte unique :** `(chantier_id, user_id)`

**Migration :** `20260412120003_create_chantier_member.js`

---

## Table : `invitation`

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK, default uuid |
| `email` | varchar(255) | NOT NULL |
| `invited_by` | uuid | NOT NULL, FK -> `user.id` |
| `role` | enum `user_role` | NOT NULL, default `employee` |
| `token` | varchar(255) | NOT NULL, UNIQUE |
| `status` | enum `invitation_status` (`pending`, `accepted`, `expired`) | NOT NULL, default `pending` |
| `expires_at` | timestamp | NOT NULL |
| `created_at` | timestamp | NOT NULL, default now |

**Migration :** `20260412120004_create_invitation.js`

---

## Table : `comment`

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK, default uuid |
| `chantier_id` | uuid | NOT NULL, FK -> `chantier.id` CASCADE |
| `author_id` | uuid | NOT NULL, FK -> `user.id` CASCADE |
| `content` | text | NOT NULL |
| `created_at` | timestamp | NOT NULL, default now |
| `updated_at` | timestamp | NOT NULL, default now |

**Index :** `idx_comment_chantier` (chantier_id, created_at)

**Migration :** `20260412120005_create_comment.js`

---

## Table : `photo`

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK, default uuid |
| `chantier_id` | uuid | NOT NULL, FK -> `chantier.id` CASCADE |
| `uploaded_by` | uuid | NOT NULL, FK -> `user.id` CASCADE |
| `url` | varchar(1000) | NOT NULL |
| `thumbnail_url` | varchar(1000) | nullable |
| `caption` | varchar(500) | nullable |
| `latitude` | decimal(10,7) | nullable |
| `longitude` | decimal(10,7) | nullable |
| `taken_at` | timestamp | nullable |
| `file_size` | integer | nullable |
| `mime_type` | varchar(50) | nullable |
| `created_at` | timestamp | NOT NULL, default now |
| `updated_at` | timestamp | NOT NULL, default now |

**Index :** `idx_photo_chantier` (chantier_id, created_at)

**Migration :** `20260412120006_create_photo.js`

---

## Table : `photo_comment`

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK, default uuid |
| `photo_id` | uuid | NOT NULL, FK -> `photo.id` CASCADE |
| `author_id` | uuid | NOT NULL, FK -> `user.id` CASCADE |
| `content` | text | NOT NULL |
| `created_at` | timestamp | NOT NULL, default now |
| `updated_at` | timestamp | NOT NULL, default now |

**Migration :** `20260412120007_create_photo_comment.js`

---

## Table : `document`

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK, default uuid |
| `chantier_id` | uuid | NOT NULL, FK -> `chantier.id` CASCADE |
| `uploaded_by` | uuid | NOT NULL, FK -> `user.id` CASCADE |
| `name` | varchar(300) | NOT NULL |
| `type` | enum `document_type` (`dict`, `dt`, `bon_de_commande`, `plan`, `arrete`, `facture`, `autre`) | NOT NULL |
| `url` | varchar(1000) | NOT NULL |
| `file_size` | integer | nullable |
| `mime_type` | varchar(100) | nullable |
| `created_at` | timestamp | NOT NULL, default now |
| `updated_at` | timestamp | NOT NULL, default now |

**Index :** `idx_document_chantier_type` (chantier_id, type)

**Migration :** `20260412120008_create_document.js`

---

## Table : `calendar_integration`

Une ligne par couple (utilisateur, provider). Pour Google/Outlook on stocke le `refresh_token` chiffre ; pour Apple on stocke un `ical_token` aleatoire qui sert d'identifiant dans l'URL d'abonnement publique.

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK, default uuid |
| `user_id` | uuid | NOT NULL, FK -> `user.id` CASCADE |
| `provider` | enum `calendar_provider` (`google`, `outlook`, `apple`) | NOT NULL |
| `refresh_token_encrypted` | text | nullable (Google/Outlook uniquement, AES-256-GCM en base64) |
| `external_calendar_id` | varchar(255) | nullable (Google : `primary` par defaut ; Outlook : non utilise) |
| `ical_token` | varchar(128) | nullable, UNIQUE (Apple uniquement) |
| `last_sync_at` | timestamp | nullable |
| `created_at` | timestamp | NOT NULL, default now |
| `updated_at` | timestamp | NOT NULL, default now |

**Index :** `idx_calendar_integration_user_id`, UNIQUE `uq_calendar_integration_user_provider` (user_id, provider), UNIQUE `uq_calendar_integration_ical_token` (ical_token)

**Migration :** `20260428194559_create_calendar_integration.js`

---

## Table : `calendar_event_link`

Lien entre un chantier et l'event externe cree dans une integration OAuth. Sert a retrouver le `external_event_id` pour faire les UPDATE et DELETE chez le provider.

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK, default uuid |
| `integration_id` | uuid | NOT NULL, FK -> `calendar_integration.id` CASCADE |
| `chantier_id` | uuid | NOT NULL, FK -> `chantier.id` CASCADE |
| `external_event_id` | varchar(255) | NOT NULL (id retourne par Google/Outlook) |
| `created_at` | timestamp | NOT NULL, default now |
| `updated_at` | timestamp | NOT NULL, default now |

**Index :** `idx_calendar_event_link_chantier_id`, UNIQUE `uq_calendar_event_link_integration_chantier` (integration_id, chantier_id)

**Migration :** `20260428194559_create_calendar_integration.js`

---

## Table : `chantier_step`

Etapes d'un chantier (ex. "Gros oeuvre", "Toiture"). Ordonnees par `position` (drag-and-drop cote UI).

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK, default uuid |
| `chantier_id` | uuid | NOT NULL, FK -> `chantier.id` CASCADE |
| `name` | varchar(200) | NOT NULL |
| `position` | integer | NOT NULL, default 0 |
| `created_at` | timestamp | NOT NULL, default now |
| `updated_at` | timestamp | NOT NULL, default now |

**Index :** `idx_chantier_step_chantier_position` (chantier_id, position)

**Migration :** `20260428205141_create_chantier_step.js`

---

## Table : `chantier_substep`

Sous-etapes a checkbox. `validated_at`/`validated_by` se remplissent au toggle ; `validation_comment` est optionnel.

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK, default uuid |
| `step_id` | uuid | NOT NULL, FK -> `chantier_step.id` CASCADE |
| `name` | varchar(300) | NOT NULL |
| `position` | integer | NOT NULL, default 0 |
| `validated_at` | timestamp | nullable |
| `validated_by` | uuid | nullable, FK -> `user.id` SET NULL |
| `validation_comment` | text | nullable |
| `created_at` | timestamp | NOT NULL, default now |
| `updated_at` | timestamp | NOT NULL, default now |

**Index :** `idx_chantier_substep_step_position` (step_id, position)

**Migration :** `20260428205141_create_chantier_step.js`

---

## Table : `chantier_emergency`

Urgences (terrain) ou reclamations (clients) attachees a un chantier. Stockees dans la meme table.

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK, default uuid |
| `chantier_id` | uuid | NOT NULL, FK -> `chantier.id` CASCADE |
| `created_by` | uuid | NOT NULL, FK -> `user.id` CASCADE |
| `photo_url` | varchar(1000) | nullable |
| `thumbnail_url` | varchar(1000) | nullable |
| `latitude` | decimal(10,7) | nullable |
| `longitude` | decimal(10,7) | nullable |
| `description` | text | nullable |
| `created_at` | timestamp | NOT NULL, default now |
| `updated_at` | timestamp | NOT NULL, default now |

**Index :** `idx_emergency_chantier_created` (chantier_id, created_at)

**Migration :** `20260501231150_create_chantier_emergency.js`

---

## Table : `emergency_comment`

Discussion attachee a une urgence. Tous les membres autorises a voir l'urgence peuvent ecrire (intervenants internes vs gestionnaire_reseau, distinction visuelle cote front via `user.role`).

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK, default uuid |
| `emergency_id` | uuid | NOT NULL, FK -> `chantier_emergency.id` CASCADE |
| `author_id` | uuid | NOT NULL, FK -> `user.id` CASCADE |
| `content` | text | NOT NULL |
| `created_at` | timestamp | NOT NULL, default now |
| `updated_at` | timestamp | NOT NULL, default now |

**Index :** `idx_emergency_comment_emergency_created` (emergency_id, created_at)

**Migration :** `20260504210853_create_emergency_comment.js`

---

## Table : `chantier_template`

Modele d'un chantier (etapes/sous-etapes + equipe pre-remplies) partage dans l'organisation.

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK, default uuid |
| `organization_id` | uuid | NOT NULL, FK -> `organization.id` CASCADE |
| `created_by` | uuid | NOT NULL, FK -> `user.id` CASCADE |
| `name` | varchar(200) | NOT NULL |
| `description` | text | nullable |
| `default_status` | enum `chantier_status` | NOT NULL, default `a_venir` |
| `created_at` | timestamp | NOT NULL, default now |
| `updated_at` | timestamp | NOT NULL, default now |

**Migration :** `20260502212952_create_chantier_template.js`

---

## Table : `chantier_template_step`

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK, default uuid |
| `template_id` | uuid | NOT NULL, FK -> `chantier_template.id` CASCADE |
| `name` | varchar(200) | NOT NULL |
| `position` | integer | NOT NULL, default 0 |
| `created_at` | timestamp | NOT NULL, default now |

**Migration :** `20260502212952_create_chantier_template.js`

---

## Table : `chantier_template_substep`

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK, default uuid |
| `template_step_id` | uuid | NOT NULL, FK -> `chantier_template_step.id` CASCADE |
| `name` | varchar(300) | NOT NULL |
| `position` | integer | NOT NULL, default 0 |
| `created_at` | timestamp | NOT NULL, default now |

**Migration :** `20260502212952_create_chantier_template.js`

---

## Table : `chantier_template_member`

Membres pre-remplis sur un modele. Lors de l'utilisation du modele (`/use`), ces utilisateurs sont copies dans `chantier_member` avec mapping role global -> role chantier (`admin`/`manager` -> `responsable`, `employee` -> `ouvrier`).

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK, default uuid |
| `template_id` | uuid | NOT NULL, FK -> `chantier_template.id` CASCADE |
| `user_id` | uuid | NOT NULL, FK -> `user.id` CASCADE |
| `created_at` | timestamp | NOT NULL, default now |
| `updated_at` | timestamp | NOT NULL, default now |

**Contraintes :** UNIQUE (`template_id`, `user_id`)

**Index :** `idx_template_member_template` (template_id)

**Migration :** `20260504212129_create_chantier_template_member.js`

---

## Table : `push_token`

Tokens Expo Push enregistres par device. Un user peut avoir plusieurs lignes (un par device). `token` est UNIQUE — quand un device se reaffecte a un autre user (changement de compte), la ligne existante est mise a jour via ON CONFLICT.

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK, default uuid |
| `user_id` | uuid | NOT NULL, FK -> `user.id` CASCADE |
| `token` | varchar(500) | NOT NULL, UNIQUE |
| `platform` | varchar(20) | nullable (`ios` \| `android` \| `web`) |
| `created_at` | timestamp | NOT NULL, default now |
| `updated_at` | timestamp | NOT NULL, default now |

**Index :** `idx_push_token_user` (user_id)

**Migration :** `20260505204053_create_push_token_and_push_enabled.js`

### Colonne ajoutee a `user`

| Colonne | Type | Contraintes |
|---|---|---|
| `push_enabled` | boolean | NOT NULL, default `true` |

Toggle global ON/OFF des notifications. Quand `false`, `sendPushToUsers` skip l'utilisateur entier (toutes plateformes confondues).
