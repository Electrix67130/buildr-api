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

## Numeros de telephone

`user.phone` et `organization.phone` sont stockes et renvoyes en **E.164**
(`+33612345678`) : pas d'espaces, pas de separateurs, indicatif obligatoire.

En entree, l'API accepte la saisie courante — `06 12 34 56 78`,
`06.12.34.56.78`, `+33 6 12 34 56 78`, `0033612345678` — et la ramene a ce
format. Un numero sans indicatif est lu avec le pays de l'organisation
(`organization.country`), la France par defaut. Un numero invalide est refuse en
`400 Numéro de téléphone invalide`, que la forme soit fausse (`bonjour`) ou que le
numero n'existe pas (`06 12 34`).

Le client formate pour l'affichage ; il n'a jamais a nettoyer la saisie.

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

### Adresses e-mail

Toute adresse qui entre dans l'API — inscription, connexion, mot de passe
oublie, invitation, modification de profil — est **passee en minuscules** et
debarrassee de ses espaces avant toute comparaison ou ecriture
(`src/lib/email.ts`). `Arthur@gmail.com` et `arthur@gmail.com` designent le
meme compte, et la base le garantit par un index unique sur `lower(email)`.

Jusque-la l'API distinguait les deux : un salarie inscrit seul en minuscules,
puis invite avec la majuscule que son telephone avait ajoutee, obtenait deux
comptes dans deux organisations. La reponse de l'API renvoie toujours
l'adresse normalisee ; les clients n'ont rien a faire de particulier.

### POST /auth/register

**Body :**
```json
{
  "email": "string (required)",
  "password": "string min 8 (required)",
  "first_name": "string (required)",
  "last_name": "string (required)",
  "phone": "string (required) — voir « Numeros de telephone »",
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

**Compte desactive :** `403` avec `error: "AccountDisabled"` — mais seulement
si le mot de passe est le bon. Avant, la reponse reste le `401` generique :
confirmer qu'une adresse a un compte, meme desactive, renseignerait un tiers.
Les clients affichent alors « Ce compte est desactive. Contactez votre
administrateur » plutot qu'« identifiants incorrects ».

**Sessions par plateforme** — chaque plateforme garde sa propre session active.
Se connecter sur le mobile n'invalide que la precedente session mobile ; le
dashboard reste ouvert, et inversement. Une seconde connexion sur la MEME
plateforme invalide la premiere (token rejete avec un 401 « Session expired
(logged in elsewhere on this device type) », et WebSocket ferme avec le code
4001).

**Desactivation (`PATCH /users/:id` avec `is_active: false`, ou la console) :**
toutes les sessions du compte sont coupees sur-le-champ — jetons de
rafraichissement supprimes, identifiants de session remis a zero, WebSocket
fermees avec le code **4002** (`account-disabled`). Les clients reconnaissent
ce code, se deconnectent et disent pourquoi. Sans cela le jeton d'acces en
cours restait valable jusqu'a son expiration, un quart d'heure.

**Suppression (`DELETE /users/me`, `DELETE /users/:id`, console) :** meme
coupure immediate, code **4003** (`account-deleted`). Le cas typique est le
dashboard reste ouvert pendant qu'on supprime son compte depuis le telephone.

Le code 4001 n'est envoye que sur une **connexion neuve** : un renouvellement
de jeton vient de l'appareil deja connecte et ne ferme pas sa WebSocket.
Jusqu'a la 1.7.3, il la fermait aussi, et l'app se deconnectait toutes les
quinze minutes des qu'elle etait au premier plan au moment du renouvellement.

`/auth/logout` ne coupe egalement que la session de la plateforme d'ou provient
le token. Les tokens emis avant l'introduction du claim `platform` restent
acceptes sans controle de session, jusqu'a la prochaine connexion.

**Invitations en attente** — a chaque connexion reussie, ainsi qu'a chaque
`GET /auth/me`, l'API honore les
invitations `pending` et non expirees adressees a l'e-mail du compte (casse
ignoree) : membership creee avec le role de l'invitation, invitation passee a
`accepted`, entree dans l'equipe de l'inviteur s'il est manager. Si
l'organisation active du compte est une coquille (il en est le seul membre et
elle n'a aucun chantier), `active_organization_id` bascule vers l'organisation
invitante et le `user` renvoye reflete deja ce changement. Sinon le contexte
ne bouge pas : la nouvelle organisation apparait dans `memberships` de
`/auth/me` et se choisit via `/auth/switch-organization`. Voir « Invitations »
pour le pourquoi.

### POST /auth/refresh

**Body :** `{ "refresh_token": "string" }`

**Reponse 200 :** `{ "access_token": "jwt", "refresh_token": "uuid" }`

**Durees.** Le jeton d'acces vit `JWT_ACCESS_EXPIRES` (15 min par defaut).
Le jeton de rafraichissement est renouvele a chaque echange (rotation) et n'a
pas de duree fixe ; il est refuse apres **90 jours sans usage**, lus sur sa
date de creation puisque chaque usage en cree un neuf.

**Tolerance de reutilisation (1 min).** La rotation ne supprime plus
l'ancien jeton : il est marque remplace, avec son successeur. Rejoue dans la
minute, il **redonne la session en cours** — meme identifiant de session,
meme jeton de rafraichissement vivant — au lieu d'un 401. C'est le cas d'une
reponse perdue : reseau coupe sur un chantier, app tuee par le systeme
pendant l'echange. L'appareil se raccroche sans qu'une seconde session soit
creee. Passe le delai, ou si la session en cours a ete fermee entre-temps
(deconnexion, nouvelle connexion, coupure), le jeton remplace repond 401.
Une connexion neuve balaie tous les jetons de la plateforme, remplaces
compris.

**Cote clients**, seul un **401** de cette route doit effacer les jetons.
Toute autre reponse (502 pendant un redeploiement, 500, erreur reseau) est
passagere : on garde la session et on reessaiera. Jusqu'a la version 1.4.3
des clients, n'importe quel echec deconnectait — et l'API redemarre a chaque
deploiement.

### POST /auth/forgot-password

**Body :** `{ "email": "string" }`

**Reponse 200 :** `{ "message": "If an account exists with this email, a reset link has been sent." }`

### POST /auth/reset-password

**Body :** `{ "token": "string", "new_password": "string min 8" }`

**Reponse 200 :** `{ "message": "Password has been reset successfully" }`

### POST /auth/logout

**Reponse 204** (no content)

### GET /auth/me

Honore au passage les invitations en attente adressees a l'e-mail du compte
(voir « Invitations » — compte deja existant).

**Reponse 200 :** objet user (sans password_hash)

---

## Temps reel (WebSocket)

`GET /ws?token=<jwt>&api_key=<cle>` ouvre un canal par appareil. Le serveur y
pousse des evenements `{ type, chantier_id?, resource_id?, actor_id? }` ; le
client invalide les caches concernes et relit. L'auteur de l'action n'est pas
notifie de sa propre action.

| Evenement | Destinataires | Le client relit |
|---|---|---|
| `comment.*`, `photo.*`, `document.*`, `emergency.*`, `emergency-comment.*` | participants du chantier | la ressource et les compteurs non lus |
| `chantier-member.created` / `.updated` | participants du chantier | les membres et la liste des chantiers |
| `chantier-member.deleted` | participants **et le membre retire** | les membres et la liste des chantiers |
| `membership.updated` | l'utilisateur dont le role a change | tout : son profil (donc ses droits), ses listes |

`membership.updated` est emis par `PATCH /users/:id` quand le role change. Sans
lui, un collaborateur promu administrateur gardait ses anciens droits a l'ecran
jusqu'a la prochaine relecture de son profil (retour au premier plan, ou tirer
pour rafraichir).

## Users

| Methode | Route | Auth | Description |
|---|---|---|---|
| GET | `/users` | JWT | Liste paginee (scopee par role — voir ci-dessous) |
| GET | `/users/:id` | JWT | Detail (membre de son organisation, ou soi-meme) |
| GET | `/users/search?q=xxx` | JWT | Recherche par nom/email/entreprise |
| POST | `/users` | JWT | Creer |
| PATCH | `/users/:id` | JWT | Modifier (soi-meme, ou un membre de son organisation si admin) |
| DELETE | `/users/me` | JWT | Supprimer son propre compte (voir ci-dessous) |
| DELETE | `/users/:id` | JWT | Supprimer (admin, membre de son organisation uniquement) |

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

**Le meme comportement vaut pour `DELETE /users/:id`** (admin de l'organisation) et
pour la console (`DELETE /super-admin/users/:id`) : anonymisation, jamais de suppression
physique. Un admin ne peut pas supprimer le seul administrateur d'une autre organisation
(`409`). Avant, ces deux chemins supprimaient la ligne : les photos et messages du compte
partaient en cascade, et la suppression echouait des qu'il avait cree un chantier. La
console garde une purge physique explicite, `?purge=1`, pour les demandes d'effacement
complet, avec ces deux effets assumes.

### Console : `GET /super-admin/users`

Filtres : `q` (email, nom), `organization_id` (membre de cette organisation),
`role` (role dans l'organisation filtree, ou dans n'importe laquelle sinon),
`status` (`active` | `disabled` | `deleted` — `disabled` exclut les comptes
anonymises), `super_admin=1`, `sort` (`created_at` | `last_name` | `email`),
`order`. Chaque ligne porte `organizations: [{ id, name, role }]` et
`deleted_at`, pour distinguer un compte desactive d'un compte supprime.

**Comportement** — la ligne `user` n'est pas supprimee physiquement : plusieurs FK sont en
RESTRICT (`chantier.created_by`, `invitation.invited_by`, `organization.created_by`), un
DELETE echouerait des que l'utilisateur a cree un chantier. Elle est **anonymisee** :
`email` neutralise, `first_name`/`last_name` remplaces, `phone`/`avatar_url`/`company_name`
vides, `password_hash` rendu invalide, `is_active` a false, `deleted_at` horodate.

Sont **supprimes** : `refresh_token`, `push_token`, `calendar_integration`,
`organization_member`, `chantier_member`, `chantier_template_member`, `team_member`.

Sont **conserves** : chantiers, photos, documents et messages crees — ils appartiennent a
l'organisation et apparaissent desormais sous « Compte supprime ».

### Un seul garde pour les chantiers

`isChantierAdminOrCreator()` et `isChantierParticipant()` (`lib/permissions.ts`)
sont les **seuls** endroits ou s'ecrit « cette personne a-t-elle autorite sur ce
chantier ». La regle etait auparavant recopiee dans chaque module qui en avait
besoin — permissions, etapes, urgences, membres — et chaque copie oubliait la
meme moitie : verifier que le chantier appartient bien a l'organisation de
l'administrateur.

Tout nouveau module qui a besoin de cette regle doit appeler ces fonctions, et
non la reecrire.

Le fil de discussion d'une urgence (`/emergency-comments`) exige d'etre
participant du chantier : il ne verifiait auparavant que l'authentification.

### Sessions coupees pour de bon

`disable`, `kick-sessions` et `force-reset` (console super admin) remettent a
zero les identifiants de session et purgent le cache, en plus de supprimer les
jetons de rafraichissement. Supprimer ces derniers empeche le RENOUVELLEMENT,
pas l'usage : le jeton d'acces deja emis restait valable un quart d'heure —
precisement le temps pendant lequel on croyait avoir coupe un compte compromis.

### Cloisonnement des equipes et des chantiers

`GET /teams/:manager_id` et `DELETE /teams/:id` exigent que l'equipe visee
appartienne a l'organisation active de l'appelant. Le module lisait la colonne
vestigiale `user.role`, globale, plutot que `organization_member.role` : etre
administrateur QUELQUE PART suffisait a lire et defaire les equipes de n'importe
quelle entreprise.

Le meme defaut existait dans `lib/permissions.ts` : le contournement
administrateur ne verifiait pas que le chantier appartenait a son organisation.
Un admin de l'organisation A avait donc tous les droits sur les documents, les
photos et les discussions des chantiers de l'organisation B.

### Cloisonnement des routes utilisateur

`GET`, `PATCH` et `DELETE /users/:id` exigent que la cible partage
l'organisation active de l'appelant (l'edition de son propre profil restant
toujours permise). Une cible d'une autre organisation repond **404**, jamais
403 : dire « interdit » confirmerait que l'identifiant existe.

Seul le champ `role` etait cloisonne auparavant. Un admin de l'organisation A
qui connaissait un identifiant de l'organisation B pouvait donc lire ce profil,
desactiver le compte, changer son adresse, ou le supprimer — et la cascade sur
`company_name`, indexee sur l'organisation de l'**editeur**, renommait au passage
sa propre organisation.

### Au moins un administrateur par organisation

Retrograder ou supprimer le dernier `admin` d'une organisation repond **409**.
Sans ce garde-fou, plus personne ne peut inviter, gerer les comptes ni creer de
chantier, et l'API n'offre aucune voie de retour — il faudrait un acces direct a
la base. La suppression de son PROPRE compte (`DELETE /users/me`) n'est pas
concernee : l'App Store l'exige sans condition.

### PATCH /users/:id — langue du compte

Le champ `locale` (`fr | en | de | es | it | pt | tr | pl`) fixe la langue des
**e-mails et des notifications** envoyes a ce compte. Chacun peut modifier la
sienne ; les clients l'envoient quand l'utilisateur change la langue de
l'interface.

Sans lui, `user.locale` etait renseigne a l'inscription puis fige a jamais :
quelqu'un qui passait l'application en allemand continuait de recevoir ses
e-mails de reinitialisation et ses notifications en francais, sans aucun recours.

### PATCH /users/:id — le role vit sur la membership

Le `role` transmis met a jour `organization_member.role` pour
**l'organisation active de l'editeur**, pas la colonne `user.role`. C'est
`organization_member` que lit `getActiveMembership()`, donc c'est lui qui
determine les droits reels.

La colonne `user.role` est un vestige, conservee en phase pour ne pas
diverger, mais elle ne fait pas autorite. Avant correction, le PATCH
n'ecrivait que cette colonne : la fiche affichait le nouveau role, la liste
et les permissions gardaient l'ancien. `GET /users/:id` renvoie desormais
lui aussi le role de la membership, comme `GET /users`.

Si la cible n'est pas membre de l'organisation active de l'editeur, la
requete repond `404`.

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

### Les permissions d'un administrateur ne se modifient pas

Un administrateur de l'organisation a toujours tout sur ses chantiers : ses
drapeaux `can_*` ne sont jamais lus (`lib/permissions.ts`). `PATCH
/chantier-members/:id` sur un tel membre repond **409** ; les clients affichent
« acces complet » a la place des interrupteurs. `GET
/chantier-members/by-chantier` expose `user_role`, le role dans l'organisation
**du chantier** (lu sur `organization_member`, plus sur la colonne vestigiale
`user.role`), pour que les clients sachent qui est administrateur.

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
| GET | `/invitations` | JWT | Liste des invitations (admin ou manager, **sans le `token`**) |
| POST | `/invitations` | JWT | Inviter un collaborateur |
| POST | `/invitations/:token/accept` | Non | Accepter une invitation |
| DELETE | `/invitations/:id` | JWT | Annuler une invitation (admin ou manager, meme organisation) |

### Le jeton ne sort jamais de la liste

`GET /invitations` est reserve aux **admins et managers**, et sa projection omet
le champ `token`.

Les deux tiennent a la meme raison : `POST /auth/register` accepte n'importe quel
jeton en attente **sans authentification**, avec le role qu'il porte. Tant que la
liste sortait le jeton pour tout membre authentifie, un ouvrier pouvait lire
celui de l'invitation admin d'un collegue, s'en servir, et devenir
administrateur de l'entreprise. Le jeton ne doit exister qu'a deux endroits : la
base, et le mail de son destinataire.

### Ce que la liste contient

`GET /invitations` ne renvoie que les invitations **encore utilisables** :
`status = pending` et non expirees. Une invitation acceptee n'attend plus
personne, et une invitation perimee ne peut plus servir — son jeton est refuse
par `/invitations/by-token` comme par `/auth/register`. L'afficher « en
attente » laissait croire qu'on attendait une personne deja dans l'equipe.

Deux regles tiennent cette liste a jour sans intervention :

- **Reinviter remplace.** `POST /invitations` passe en `expired` toute
  invitation `pending` de la meme adresse dans la meme organisation avant d'en
  creer une nouvelle. L'ancien lien cesse de fonctionner.
- **Arriver solde tout.** Quand une invitation est honoree — inscription par
  le lien, ou rattachement d'un compte existant — toutes les invitations
  `pending` de cette adresse dans cette organisation passent en `accepted`,
  pas seulement celle qui a servi.

Une migration (`20261003150000_settle_stale_invitations.js`) a solde
l'existant : les invitations restees en attente alors que la personne etait
deja membre.

### Langue des e-mails

Deux mecanismes, parce que les deux situations different.

**Invitation** : `POST /invitations` accepte un champ `locale`. C'est celui qui
invite qui tranche — on ne connait pas encore l'invite, et son employeur est le
seul a savoir dans quelle langue il travaille.

**Reinitialisation de mot de passe** : la langue vient de `user.locale`.
Personne ne peut la choisir au moment de l'envoi, puisque c'est l'utilisateur
qui declenche la demande et qu'il n'est pas connecte. Elle est donc renseignee a
l'inscription : depuis l'invitation quand il y en a une, sinon depuis le champ
`locale` de `POST /auth/register`.

Les deux mails pointent leur bouton principal sur le **web**
(`${APP_URL}/invite/<token>` et `${APP_URL}/reset-password/<token>`), le lien
profond `buildr://` restant offert en dessous. Un lien profond n'est ouvrable
que par un telephone ou l'application est installee, alors que ces deux
parcours commencent souvent sur un ordinateur.

### POST /invitations — langue du mail

Le corps accepte un champ `locale` parmi `fr, en, de, es, it, pt, tr, pl`,
`fr` par defaut. Il fixe la langue du mail d'invitation.

C'est **celui qui invite** qui la choisit, et non une detection automatique :
on ne connait pas encore l'invite, son adresse e-mail ne dit rien de sa langue,
et son employeur est le seul a savoir dans quelle langue il travaille.

La valeur est stockee sur l'invitation plutot que consommee au vol : un renvoi
doit repartir dans la meme langue sans que l'expediteur ait a s'en souvenir.

### Le mail d'invitation

Le bouton principal pointe sur `${APP_URL}/invite/<token>`, pas sur le lien
profond `buildr://invite/<token>`.

Le schema `buildr://` n'est ouvrable que par un telephone ou l'application est
deja installee. Sur un ordinateur, dans un webmail ou sur un mobile sans l'app,
cliquer ne produisait rien — et l'invite en concluait que son lien etait mort.
Or le premier acces se fait le plus souvent depuis un poste de bureau.

Le lien profond reste propose en dessous, pour qui a deja l'application.

`APP_URL` doit donc pointer sur le dashboard (`https://app.getbuildr.fr`) et non
sur sa valeur par defaut `http://localhost:3001`, sans quoi le mail enverrait
l'invite sur un port de sa propre machine.

### Compte deja existant : rattachement a la connexion

Le lien d'invitation cree un compte. Si l'adresse en a deja un (le
collaborateur s'est inscrit seul avant d'etre invite, ou avait un compte chez
un autre client), `POST /auth/register` repond `409` et l'invitation reste
`pending` : rien ne rattachait ce compte, l'invite restait invisible dans
l'equipe et impossible a ajouter aux chantiers. C'est arrive en production :
une salariee s'etait inscrite en tapant le nom de son entreprise comme societe,
ce qui lui a cree une organisation homonyme a elle seule, et son patron l'a
invitee une minute plus tard.

Depuis, `POST /auth/login` honore les invitations en attente de l'e-mail qui
se connecte (`InvitationService.claimPendingForUser`). Le rattachement passe
par le meme code que l'inscription par le lien (`InvitationService.redeem`),
pour que les deux parcours ne divergent jamais. Une invitation expiree n'est
pas honoree : il faut en renvoyer une. Le compte garde son ancienne
organisation, rien n'est supprime a son insu.

Un appareil qui reste connecte ne repasse pas par `/auth/login` : le meme
rattachement est donc fait a chaque `GET /auth/me`, que les apps appellent au
demarrage. Il suffit de rouvrir l'application pour que l'invitation prenne
effet, et la reponse de `/auth/me` reflete deja le nouveau contexte.

### DELETE /invitations/:id

Annuler une invitation exige le role **admin ou manager**, comme la creation,
et l'invitation doit appartenir a l'organisation active de l'appelant. Une
invitation d'une autre organisation repond `404` et non `403` : un `403`
confirmerait son existence.

Auparavant l'authentification seule suffisait et l'organisation n'etait pas
verifiee.

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
| POST | `/comments/:id/reactions` | JWT | Ajouter ou retirer sa reaction (interrupteur) |

### POST /comments

**Body :** `{ "chantier_id": "uuid", "content": "string", "step_id"?: "uuid", "reply_to_id"?: "uuid" }`

**Reponse 201 :** commentaire cree (author_id = utilisateur connecte)

### Repondre a un message, reagir d'un emoji

`reply_to_id` designe le message cite ; il doit appartenir au meme chantier,
sinon **400**. La liste renvoie sur chaque message `reply_to: { id, content,
author_id, first_name, last_name } | null` — `null` aussi quand le message cite
a ete supprime depuis (la reponse reste, sans citation).

`POST /comments/:id/reactions` avec `{ "emoji": "👍" }` ajoute la reaction de
l'appelant, ou la retire s'il l'avait deja posee. Les emojis admis sont la
liste fermee `REACTION_EMOJIS` (`comment.schema.ts`) : 👍 ❤️ 😂 😮 😢 🙏 🔥.
Reponse : `{ comment_id, reactions }`. La liste renvoie sur chaque message
`reactions: [{ emoji, count, mine }]`, `mine` du point de vue de l'appelant.
Chaque bascule emet `comment.updated` sur le canal temps reel.

---

## Signalements de contenu ou de membre

| Methode | Route | Auth | Description |
|---|---|---|---|
| POST | `/reports` | JWT | Signaler un message, une photo ou un membre |
| GET | `/reports` | JWT, admin de l'organisation | Les signalements de son organisation, `?status=&chantier_id=` |
| PATCH | `/reports/:id` | JWT, admin de l'organisation ou super admin | Traiter (`resolved`) ou rejeter (`dismissed`), avec note |
| GET | `/super-admin/reports` | JWT + super admin | Tous les signalements, `?escalated=1&organization_id=&status=` |

**Body de `POST /reports` :** `{ target_type: "comment" | "photo" | "user", target_id,
reason: "inappropriate" | "harassment" | "off_topic" | "other", comment? }`.

C'est d'abord l'affaire de **l'administrateur de l'organisation** : lui connait
l'equipe et a deja les deux leviers, supprimer le contenu ou desactiver le
compte. Le signalement lui parvient par le canal temps reel (`report.created`)
et par notification, dans sa langue. Regles :

- Le rapporteur doit avoir acces a ce qu'il signale : participant du chantier
  pour un message ou une photo, une organisation en commun pour un membre.
  Sinon **404**, pour ne pas confirmer l'existence de la cible. On ne se
  signale pas soi-meme (**400**).
- **La personne visee ne voit jamais le signalement qui la concerne**, meme
  administratrice, et ne peut pas le classer.
- Si la personne visee est administratrice, le signalement est marque
  `escalated` et remonte aussi a la console super admin : une organisation
  peut n'avoir qu'un administrateur.
- Idempotent : re-signaler une cible deja signalee par la meme personne et
  encore en attente rend le signalement existant (**200**).
- La cible est designee sans cle etrangere et son contenu est fige dans
  `target_excerpt` : supprimer le message est souvent l'issue, et le
  signalement doit survivre pour garder trace. `target_exists` dit si elle
  existe encore.

Reponse des listes : `{ data, meta, counts: { pending } }`, chaque ligne avec
le nom du rapporteur, celui de la personne visee, du chantier et de
l'organisation. Pas de blocage d'utilisateur pour l'instant.

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

## Signalements utilisateur (bugs et suggestions)

A ne pas confondre avec `/error-reports`, qui collecte les plantages
automatiquement. Ici c'est un humain qui ecrit, et il attend une reponse.

| Methode | Route | Auth | Description |
|---|---|---|---|
| POST | `/feedbacks` | JWT | Deposer un bug ou une suggestion |
| GET | `/feedbacks/mine` | JWT | Ses propres signalements et les reponses recues |
| GET | `/feedbacks/mine/:id` | JWT | Le detail d'un de ses signalements |
| GET | `/super-admin/feedbacks` | JWT + super admin | Tous les signalements, filtrables |
| GET | `/super-admin/feedbacks/:id` | JWT + super admin | Fiche complete avec auteur |
| PATCH | `/super-admin/feedbacks/:id` | JWT + super admin | Changer le statut, ecrire une reponse |

**POST /feedbacks — body :**
```json
{
  "type": "bug | suggestion (requis)",
  "subject": "string (requis, 3 a 150)",
  "message": "string (requis, 10 a 5000)",
  "platform": "mobile | web (optionnel)",
  "app_version": "string (optionnel, max 40)",
  "screen": "string (optionnel, max 200)",
  "locale": "fr | en | de | es | it | pt | tr | pl (optionnel)"
}
```

`organization_id` est deduit de l'organisation active — il n'est pas accepte dans
le body. Un utilisateur sans organisation active peut deposer malgre tout : c'est
peut-etre precisement de cela qu'il veut parler. `locale` retombe sur la langue du
compte : c'est dans celle-la qu'il faut repondre.

**Reponse 201** : la ligne creee, avec `status: "new"`.

**GET /feedbacks/mine** : liste paginee. Chacun ne voit que les siens ; le
signalement d'autrui repond **404** et non 403, pour ne pas confirmer son
existence.

**GET /super-admin/feedbacks** — parametres : `page`, `limit`, `status`, `type`,
`q`. La recherche `q` porte sur le sujet, le message et l'adresse de l'auteur.
Reponse : `{ data, meta, counts }`, ou `counts` donne le nombre de signalements
par statut. Le tri place les `new` en tete, puis les `in_progress`, puis le
reste — une console de support se lit par ce qui reste a traiter. Chaque ligne
est enrichie de `author_email`, `author_first_name`, `author_last_name`,
`organization_name` et `responder_email`.

**PATCH /super-admin/feedbacks/:id — body :**
```json
{
  "status": "new | in_progress | resolved | declined (optionnel)",
  "response": "string | null (optionnel, max 5000)"
}
```

Au moins un des deux champs est requis. Ecrire une reponse passe le statut a
`resolved` sauf si un autre est precise explicitement : repondre, c'est traiter.
Passer `response: null` retire la reponse et efface le repondant. Chaque appel
laisse une ligne dans `audit_log` (`action: "feedback.respond"`) : ecrire a un
utilisateur au nom du produit doit rester attribuable.

Ecrire une **nouvelle** reponse envoie une notification push a l'auteur, dans la
langue du signalement (`locale`), avec `data: { type: "feedback", feedback_id }` —
l'app mobile ouvre alors l'ecran des signalements. Ni un simple changement de
statut, ni le reenregistrement du meme texte ne renotifient : classer un
signalement n'est pas une nouvelle a annoncer. L'envoi est detache de la reponse
HTTP, et un echec cote Expo ne fait jamais perdre une reponse deja enregistree.
Le refus des notifications (`user.push_enabled`) est respecte.

La console support n'est **pas** ouverte aux administrateurs d'organisation : un
signalement peut parler d'un collegue ou d'un client, il va au support, pas a la
hierarchie de l'entreprise.

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
URLs stockees en **URLs signees valables 24 heures**, via un token HMAC. Un
client qui garde une URL en cache au-dela doit la regenerer avec
`GET /files/token/:filename`.

**Les URLs sont stockees nues, et toujours re-signees a la lecture.** Le hook
global signe toutes les reponses, celle de `/upload` comprise : les clients
renvoyaient donc a la creation une URL deja signee, la base gardait son jeton,
et la signature des listes — qui ne touchait pas a une URL deja signee — le
servait tel quel. Vingt-quatre heures plus tard, toutes les photos de la veille
repondaient 403 et seules celles du jour s'affichaient. Les schemas retirent
desormais le jeton a l'ecriture (`stripFileToken`), `signFileUrl` en pose un
frais quoi qu'il arrive, et une migration a nettoye l'existant.

La duree etait de 5 minutes, ce qui etait plus court que la duree de vie du
cache client : l'app conserve la reponse contenant l'URL deja signee et
redemandait ensuite l'image avec un jeton perime. Le symptome etait muet — la
galerie se vidait sans message, et les logs de production montraient des jetons
expires depuis plus de 80 heures.

La valeur vit dans `FILE_URL_TTL_MS` (`src/lib/sign-url.ts`) et est partagee par
les trois emetteurs : la signature des reponses, le endpoint
`/files/token/:filename` et l'URL presignee S3. Les trois en avaient leur propre
copie, ce qui invitait a la derive.

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

### Photos rattachees a une etape

`POST /photos` accepte `step_id` ou `substep_id` (uuid, optionnels) : la photo
atteste la validation de cette etape. Une photo de sous-etape porte aussi
`step_id`, pose par l'API. L'etape doit appartenir au `chantier_id` donne,
sinon **400**. `GET /photos?chantier_id=…&step_id=…` ne renvoie que les photos
de cette etape, sous-etapes comprises. Supprimer l'etape detache la photo
(`SET NULL`) sans la supprimer : elle reste dans la galerie.

`GET /chantiers/:chantier_id/steps` renvoie sur chaque etape et chaque
sous-etape un tableau `photos: [{ id, url, thumbnail_url, step_id,
substep_id, created_at }]`, pour afficher les vignettes sans croiser la
galerie avec l'arbre. `photos` d'une etape ne contient que les photos de
l'etape elle-meme, pas celles de ses sous-etapes.

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

### Plusieurs photos par urgence

`POST /emergencies` accepte `photos: [{ url, thumbnail_url?, file_size?, mime_type? }]`
(jusqu'a 20). Elles entrent dans la table `photo` du chantier, rattachees par
`emergency_id`, et sont renvoyees sur chaque urgence dans `photos: [{ id, url,
thumbnail_url, created_at }]`. L'ancienne forme a une seule `photo_url` reste
acceptee ; `photo_url` garde toujours la premiere photo, pour les clients qui ne
lisent pas encore `photos`. `POST /emergencies/:id/photos` en ajoute apres coup
(auteur de l'urgence, ou droit `edit` sur le chantier). Supprimer l'urgence
emporte ses photos. **La galerie du chantier (`GET /photos`) ne les renvoie
pas**, et les compteurs de photos non lues ne les comptent pas : elles se
voient sur l'urgence, qui a ses propres compteurs. Migration `20261004140000_emergency_photos.js`, qui a repris
les photos existantes dans la galerie.

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

**Langue.** Chaque destinataire recoit la notification dans la langue de son
compte (`user.locale`), francais a defaut. Une meme notification de chantier peut
donc partir en plusieurs langues : l'API d'Expo acceptant des messages
differents dans un meme lot, cela ne coute aucun appel reseau supplementaire.
Seule exception, la reponse a un signalement suit la langue du **signalement**,
pas celle du compte : c'est la langue dans laquelle la personne a ecrit.

Les textes vivent tous dans `src/lib/push-i18n.ts`, avec un constructeur par
type de notification. Aucun module ne compose de texte lui-meme.
