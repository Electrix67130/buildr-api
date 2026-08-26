# Buildr — Hébergement

Document de référence pour savoir où tourne quoi, combien ça coûte, et
comment le domaine est câblé.

**Dernière mise à jour :** 26 août 2026
**Phase :** beta (1 à 3 entreprises partenaires)
**Domaine :** `getbuildr.fr`
**Serveur :** VPS Scaleway, Paris — `51.15.214.102`

> **Ce document a changé de nature.** Il décrivait un *plan* rédigé en
> mai 2026 ; il décrit désormais l'installation **réellement en place**.
> Deux briques de ce plan ont été abandonnées en route et n'existent
> nulle part dans l'infrastructure actuelle :
>
> - **Cloudflare** — la zone DNS est chez **Scaleway Domains**, et le
>   HTTPS est assuré par **Caddy** sur le serveur (Let's Encrypt). Il
>   n'y a donc ni CDN, ni anti-DDoS, ni proxy devant le VPS : les
>   enregistrements `A` pointent directement sur son IP publique.
> - **Resend** — les mails partent par **Scaleway Transactional Email**,
>   la réception passe par **OVH Zimbra**. Le code Resend subsiste dans
>   `src/lib/mailer.ts` mais `RESEND_API_KEY` est vide en production,
>   donc cette branche est inerte. Tout est détaillé dans
>   **`docs/EMAIL.md`**, qui fait autorité sur la messagerie.
>
> Les sections ci-dessous ont été reprises en conséquence. La section 8
> (comparaison des hébergeurs) reste un document de décision, pas une
> description de l'existant.

---

## 1. Vue d'ensemble

Quatre applications, un seul serveur pour la phase beta.

```
                    Scaleway Domains
                (zone DNS : ns0/ns1.dom.scw.cloud)
                           │
            ┌──────────────┼──────────────┐
            │              │              │
    getbuildr.fr   app.getbuildr.fr  api.getbuildr.fr
       (vitrine)      (dashboard)        (API)
            │              │              │
            └──────────────┼──────────────┘
                           │  A → 51.15.214.102 (direct, sans proxy)
                           ▼
              ┌─────────────────────────────┐
              │  VPS Scaleway — Paris       │
              │                             │
              │  Caddy (sur l'hôte)         │
              │   HTTPS Let's Encrypt       │
              │   reverse proxy vers :      │
              │     127.0.0.1:3000  api     │
              │     127.0.0.1:3001  vitrine │
              │     127.0.0.1:3002  dashbrd │
              │  ─────────────────────────  │
              │  Docker Compose :           │
              │   - buildr-api (Fastify)    │
              │   - buildr-db (Postgres 17) │
              │   - buildr-website          │
              │   - buildr-dashboard        │
              └──────────┬──────────────────┘
                         │
                         ▼
              ┌─────────────────────────┐
              │  Scaleway Object        │
              │  Storage — Paris        │
              │  (sauvegardes de la     │
              │   base ; photos et      │
              │   documents : voir §2B) │
              └─────────────────────────┘

Email : réception OVH Zimbra · envoi Scaleway TEM  → docs/EMAIL.md
```

Point à retenir sur l'exposition réseau : seul Caddy écoute sur
l'extérieur. Les conteneurs publient sur `127.0.0.1` uniquement — y
compris Postgres, joignable sur le port 5432 **du localhost du VPS
seulement**, donc via un tunnel SSH pour un client comme DataGrip.

---

## 2. Scaleway — l'hébergeur principal

**Pourquoi Scaleway :** entreprise française (groupe Iliad/Free), data
centers en France (Paris), console et facture en français, prix
corrects, conformité RGPD native.

### 2.1 Ce qui est pris

**A. Le serveur (Virtual Instances)**

  Produit : **DEV1-M** — 3 vCPU, 4 Go RAM, 40 Go SSD
  Zone : `fr-par-1` (Paris)
  Nom : `buildr-prod`
  IP publique : `51.15.214.102`
  Coût : ~14 €/mois

  C'est là que tournent l'API, la base de données, le dashboard web et
  le site vitrine, tous en Docker, plus Caddy sur l'hôte.

  Gabarit **confirmé sur la machine le 26 août 2026** (`COMMERCIAL_TYPE`
  des métadonnées Scaleway) : 3 vCPU, 3,8 Gio de RAM utilisable, 45 Go
  de partition racine.

  Marge à cette date : 1,1 Gio de RAM consommée sur 3,8 et 9,6 Go de
  disque sur 45 (22 %). Rien ne presse côté dimensionnement — c'est
  PostgreSQL à côté de Node qui justifiait les 4 Go, et il respire.

  Quand monter en taille : vers 10 entreprises, un PRO2-XXS
  (~24 €/mois) est la marche suivante.

  Les métadonnées se relisent depuis la machine, sans passer par la
  console :

```bash
curl -s http://169.254.42.42/conf | grep -E '^(COMMERCIAL_TYPE|ZONE|HOSTNAME)='
```

**B. Le stockage (Object Storage)**

  Produit : Object Storage, gamme Standard, région Paris (par)
  Bucket : `buildr-uploads`
  Coût : 75 Go gratuits, puis ~0,015 €/Go/mois

  Compatible API S3 : le code s'en sert comme d'un dossier en ligne,
  sans dépendre du fournisseur. Migrer ailleurs reste possible.

  Ce qu'on y met, **vérifié en production le 26 août 2026** :

  - les photos de chantier et les documents — `STORAGE_MODE=s3`,
    endpoint `https://s3.fr-par.scw.cloud` ;
  - les sauvegardes quotidiennes de la base, sous le préfixe
    `backups/` (section 5).

  Les deux partagent le même bucket : `BACKUP_S3_BUCKET` n'étant pas
  défini, `scripts/upload-backup.js:23` retombe sur `S3_BUCKET`. Les
  isoler dans un bucket dédié reste possible plus tard sans toucher au
  code.

  Le mode `local` existe toujours dans le code (`src/lib/storage.ts`)
  et sert en développement. **Ne pas le laisser passer en production** :
  les fichiers vivraient alors dans un volume Docker que le cron de
  sauvegarde ne couvre pas, et le dump Postgres ne contient pas les
  fichiers. Le volume `buildr_uploads` monté par
  `docker-compose.prod.yml` est un reliquat de cette époque, sans usage
  en mode `s3`.

  Ordre de grandeur : 75 Go ≈ 15 000 photos en qualité moyenne, ou
  30 000 compressées.

**C. Le nom de domaine (Domains)**

  `getbuildr.fr`, acheté chez Scaleway — ~8-10 €/an.

  **La zone DNS est hébergée là aussi**, servie par `ns0.dom.scw.cloud`
  et `ns1.dom.scw.cloud`. C'est le point qui change tout par rapport au
  plan initial : aucun prestataire tiers ne peut configurer la zone
  automatiquement, tous les enregistrements se créent à la main dans la
  console Scaleway.

  Le `.fr` ancre le projet sur le marché BTP français et appuie le
  discours « données hébergées en France ». Le nom principal
  `buildr.fr` est déjà pris ; `usebuildr.fr` (~9 €/an) reste à locker
  pour éviter qu'un tiers ne s'en serve pour du phishing.

### 2.2 Ce qu'il ne faut PAS prendre (pour l'instant)

  - **Bare Metal / Dedibox / Elastic Metal** : trop rigide pour la
    beta. À réévaluer au-delà de 50 entreprises.
  - **Managed Database PostgreSQL** (~14 €/mois) : utile pour
    décharger la maintenance, mais la base tourne dans Docker à côté
    de l'app — plus simple et gratuit.
  - **Kubernetes (Kapsule)** : inutile sur un seul serveur.
  - **Serverless Functions / Containers / Jobs** : inadapté à un
    process qui doit rester allumé (WebSocket temps réel).
  - **GPU / AI** : aucun besoin de calcul intensif.
  - **Load Balancer / VPC** : utiles seulement à plusieurs serveurs.
  - **Secret Manager** : un `.env` sur le serveur fait le job au départ.

### 2.3 Coût Scaleway phase beta

  Serveur DEV1-M                 14,00 €/mois
  Object Storage (< 75 Go)         0,00 €/mois
  Domaine getbuildr.fr             0,75 €/mois (~9 €/an lissé)
  Transactional Email              voir §4
  ─────────────────────────────────────────────
  TOTAL Scaleway                  ~15 €/mois

---

## 3. DNS et HTTPS — sans Cloudflare

Le plan initial confiait quatre rôles à Cloudflare : DNS, HTTPS, CDN et
anti-DDoS. Dans l'installation réelle, les deux premiers sont assurés
autrement et **les deux derniers n'existent pas**. Autant le savoir
explicitement plutôt que de croire à une protection absente.

### 3.1 DNS — Scaleway Domains

La zone est servie par `ns0.dom.scw.cloud` et `ns1.dom.scw.cloud`. Les
enregistrements applicatifs pointent directement sur l'IP du VPS :

```
getbuildr.fr        A  51.15.214.102     (vitrine)
app.getbuildr.fr    A  51.15.214.102     (dashboard)
api.getbuildr.fr    A  51.15.214.102     (API)
```

Les enregistrements de messagerie (MX, SPF, DKIM, DMARC, SRV) vivent
dans la même zone et sont documentés dans `docs/EMAIL.md`.

**Deux pièges propres à cette console**, appris à nos dépens :

- **Le point final.** Scaleway traite toute cible sans point final
  comme un nom *relatif* et lui recolle le domaine, sans le moindre
  message d'erreur. Un CNAME `zimbra1.mail.ovh.net` devient
  silencieusement `zimbra1.mail.ovh.net.getbuildr.fr.`.
- **`ns0` et `ns1` ne se synchronisent pas instantanément.** Un
  enregistrement peut être visible sur l'un et absent de l'autre
  pendant moins d'une minute. Interroger les deux avant de conclure à
  une erreur :

```bash
dig @ns0.dom.scw.cloud +short A api.getbuildr.fr
dig @ns1.dom.scw.cloud +short A api.getbuildr.fr
```

### 3.2 HTTPS — Caddy sur l'hôte

Caddy tourne directement sur le VPS (hors Docker), obtient et renouvelle
seul les certificats Let's Encrypt, et route par nom de domaine vers les
conteneurs qui écoutent en local :

```
getbuildr.fr      → 127.0.0.1:3001   (website)
app.getbuildr.fr  → 127.0.0.1:3002   (dashboard)
api.getbuildr.fr  → 127.0.0.1:3000   (api)
```

Le renouvellement des certificats est pris en charge par Caddy sans
intervention. En contrepartie, c'est une brique à maintenir sur l'hôte,
hors du cycle de déploiement Docker : une panne de Caddy coupe les trois
sites d'un coup, et un `docker compose up` ne la répare pas.

### 3.3 Ce qu'on n'a pas, et quand s'en soucier

- **Pas de CDN.** Chaque visiteur atteint Paris. Pour une clientèle BTP
  française, la latence reste bonne ; le sujet ne se posera qu'en cas
  d'audience hors de France.
- **Pas d'anti-DDoS applicatif.** L'IP du serveur est publique et
  directement joignable. Scaleway filtre les attaques volumétriques au
  niveau réseau, mais rien ne filtre une attaque applicative — et les
  ressources qui sautent en premier sont celles du VPS.
- **L'IP est exposée.** Rien ne la masque, contrairement à un montage
  derrière un proxy.

Mettre Cloudflare devant reste possible plus tard sans rien changer au
serveur : il suffirait de déléguer les nameservers et de recréer les
enregistrements. À envisager le jour où le trafic public devient un
enjeu — pas avant, chaque brique en plus étant une brique à comprendre
en cas de panne.

---

## 4. Email

**Voir `docs/EMAIL.md`** — c'est le document qui fait autorité. En
résumé :

| Flux | Prestataire | Nom utilisé |
|---|---|---|
| Réception + courrier humain | OVH Zimbra Starter (3,60 €/an HT) | `@getbuildr.fr` |
| Envoi transactionnel | Scaleway Transactional Email | `@mail.getbuildr.fr` |

Les deux flux s'authentifient séparément, sur deux noms différents :
la réputation d'expédition de l'application n'entame pas celle du
courrier humain, et inversement.

Côté code, `sendMail()` choisit son canal dans l'ordre Resend → SMTP →
log. En production c'est la branche SMTP qui sert
(`smtp.tem.scaleway.com:2587`, STARTTLS), `RESEND_API_KEY` étant vide.

Un test d'envoi réel reste à faire — voir les points ouverts de
`docs/EMAIL.md`, ainsi que l'avertissement sur `forgot-password`, qui
répond `200` sans rien envoyer quand l'adresse n'a pas de compte actif.

---

## 5. Sauvegardes

  - **Base de données** : sauvegarde automatique tous les jours à 3h du
    matin, envoyée vers Scaleway Object Storage. Conservation locale de
    30 jours, distante de 90 jours.
  - **Photos / documents** : stockés dans Object Storage
    (`STORAGE_MODE=s3`, cf. §2B), redondé par Scaleway sur 3 sites.
    Ils ne transitent donc pas par le dump Postgres, qui ne contient
    que la base.
  - **Code de l'application** : sur GitHub.

Coût des sauvegardes : ~1 €/mois (la base prend peu de place).

### Comment ça fonctionne

`scripts/backup-db.sh`, lancé par cron à 3h, produit un `pg_dump` compressé dans
`./backups/` **puis l'envoie sur le bucket** sous le préfixe `backups/`.

L'envoi passe par le conteneur de l'API (`scripts/upload-backup.js`) : le SDK S3
et les identifiants y sont déjà présents, aucune clé n'est dupliquée sur l'hôte.
Le dump est transmis par l'entrée standard, le conteneur ne voyant pas le dossier
`backups/` de l'hôte.

Un échec d'envoi **n'interrompt pas** la sauvegarde : la copie locale existe et
le script se termine en succès avec un avertissement. Un cron qui échoue est un
cron qu'on finit par ignorer.

### Expiration des copies distantes — à configurer une fois

La rotation locale est faite par le script (30 jours). Les copies distantes, non :
la clé d'API n'a **délibérément pas** le droit de supprimer un objet, ce qui
protège les sauvegardes d'une erreur de code.

Leur expiration se règle donc côté bucket, dans la console Scaleway :
**Object Storage → `buildr-uploads` → Lifecycle rules → Créer une règle**

  - Préfixe : `backups/`
  - Expiration des objets : 90 jours
  - Expiration des versions non courantes : 7 jours

Le versioning étant activé, la seconde ligne est nécessaire : sans elle, un objet
supprimé continuerait d'être facturé à travers ses anciennes versions.

Le préfixe et le bucket de destination sont configurables par
`BACKUP_S3_PREFIX` et `BACKUP_S3_BUCKET` si tu veux plus tard isoler les
sauvegardes dans un bucket dédié.

---

## 6. Coût total mensuel beta

  Serveur Scaleway DEV1-M                 14,00 €
  Object Storage                            0,00 €  (< 75 Go gratuits)
  Domaine getbuildr.fr                      0,75 €  (~9 €/an lissé)
  DNS + HTTPS                               0,00 €  (Scaleway Domains + Caddy)
  OVH Zimbra Starter                        0,30 €  (3,60 €/an HT lissé)
  Scaleway TEM                              à confirmer (volume beta négligeable)
  Apple Developer (lissé)                   8,00 €  (99 €/an)
  ──────────────────────────────────────────────────
  TOTAL                                   ~23 €/mois

  Deux lignes du plan initial ont disparu : Cloudflare (0 €, jamais
  mis en place) et Resend (0 €, remplacé par TEM). Le total ne bouge
  quasiment pas — la messagerie coûte 0,30 €/mois de plus qu'un plan
  gratuit, pour une boîte réelle et deux alias.

  Phase « scale » (10 à 50 entreprises) :
  - Serveur passe à PRO2-XXS (24 €/mois)
  - Object Storage commence à coûter (~5 €/mois pour 500 Go)
  - Base de données peut migrer vers Managed Database (~14 €/mois)
  - Total estimé : ~60 €/mois

  Phase « mature » (100+ entreprises) : voir LAUNCH-PLAN.txt section 5.

---

## 7. État de l'installation

Ce qui est en place et vérifié :

  - [x] Compte Scaleway, VPS **DEV1-M** provisionné en `fr-par-1`
        (`buildr-prod`, `51.15.214.102`)
  - [x] Domaine `getbuildr.fr` acheté chez Scaleway, zone DNS servie
        par `ns0`/`ns1.dom.scw.cloud`
  - [x] `getbuildr.fr`, `app.` et `api.` pointent sur le VPS
  - [x] Caddy sur l'hôte, HTTPS Let's Encrypt, reverse proxy vers les
        trois conteneurs — `https://api.getbuildr.fr/health` répond 200
  - [x] Stack Docker Compose déployée (`docker-compose.prod.yml`),
        déploiement par `scripts/deploy-api.sh` / `deploy-web.sh`
  - [x] Bucket Object Storage `buildr-uploads`, servant à la fois aux
        fichiers applicatifs (`STORAGE_MODE=s3`) et aux sauvegardes
  - [x] Cron de sauvegarde à 3h, envoi distant opérationnel
  - [x] Messagerie : réception OVH Zimbra + envoi Scaleway TEM
        (cf. `docs/EMAIL.md`)

Ce qui reste à faire ou à vérifier :

  - [ ] Locker `usebuildr.fr` (~9 €/an) contre le phishing
  - [ ] Poser la règle de cycle de vie sur le préfixe `backups/` (§5)
        si elle ne l'est pas déjà
  - [ ] Test d'envoi transactionnel réel (`docs/EMAIL.md`)

---

## 8. Comparaison avec les autres hébergeurs

*Section de décision, conservée telle quelle : elle documente pourquoi
Scaleway a été retenu, et vers quoi se tourner si le besoin change.*

### 8.1 o2switch vs Scaleway — le piège à éviter

**o2switch** revient souvent dans les recommandations « hébergeur
français pas cher » avec son offre **Cloud unique à ~7 €/mois**,
disque et trafic illimités. C'est tentant mais ça ne marche pas
pour Buildr — voici pourquoi.

**La différence fondamentale**

  o2switch = hébergement **mutualisé** (shared).
  Scaleway = **serveur cloud** (IaaS).

Ce sont deux métiers différents :

  - **Mutualisé** : tu loues un bout d'un serveur partagé avec
    des centaines d'autres clients. Tu n'as accès qu'à une
    interface (cPanel). Tu ne peux installer que ce que
    l'hébergeur autorise.
  - **IaaS** : tu loues un serveur entier (ou une part dédiée).
    Tu as les pleins pouvoirs (accès SSH root). Tu installes
    ce que tu veux, dans la version que tu veux.

**Ce qu'o2switch sait faire**

  - WordPress, PrestaShop, Magento, Joomla (apps PHP classiques).
  - Sites statiques (HTML/CSS/JS).
  - Base de données MySQL / MariaDB.
  - SSL Let's Encrypt automatique.
  - Support technique en français.
  - 0 administration système à gérer.

**Ce qu'o2switch ne sait PAS faire (donc bloquant pour Buildr)**

  - **Pas de Docker / Docker Compose** : l'API et le dashboard
    sont déployés en containers, impossible à reproduire en
    mutualisé.
  - **Pas de Node.js « process long »** : l'API Fastify doit
    tourner 24/7 et tenir des WebSocket pour le temps réel
    (chat, notifications). Le mutualisé coupe les process trop
    longs.
  - **Pas de PostgreSQL** : Buildr utilise Postgres ; o2switch
    ne propose que MySQL/MariaDB. Migrer la base entière pour
    rester chez o2switch ne vaut pas le coup.
  - **Pas d'accès root** : impossible d'installer un nouveau
    paquet, d'ouvrir un port, ou de configurer un reverse proxy
    comme Caddy.
  - **Pas de CI/CD** : pas de déploiement automatique depuis
    GitHub, on passe par du FTP/SFTP manuel.

**Verdict**

o2switch et Scaleway ne sont pas concurrents — ils font des
métiers différents :

  - **o2switch** : pour héberger un site WordPress ou e-commerce
    à petit prix sans rien administrer.
  - **Scaleway** : pour héberger une application SaaS moderne
    avec son propre code Node.js, sa base de données, ses
    WebSocket.

Pour Buildr (Fastify + PostgreSQL + Next.js + temps réel),
**o2switch est techniquement incompatible**. On ne paie pas
7 €/mois au lieu de 15 €/mois — on paie 7 €/mois pour quelque
chose qui ne marche pas.

**Cas où o2switch peut servir un peu** : si plus tard tu veux un
**blog WordPress séparé** pour le SEO / le contenu marketing
(`blog.getbuildr.fr`), o2switch est nickel pour ça. Mais l'app
reste sur Scaleway.

### 8.2 OVHcloud — l'alternative française la plus proche

OVH est le vrai concurrent de Scaleway en France :

  - Même métier (IaaS) et même catalogue.
  - Plus français historiquement, qualification **SecNumCloud**
    disponible (utile pour vendre au secteur public et aux grands
    comptes sensibles).
  - Console moins moderne que celle de Scaleway, documentation
    moins fluide.
  - Prix comparables.

À choisir si « 100 % français historique » est un argument
commercial fort pour tes premiers clients. À noter qu'on est déjà
client OVH pour la messagerie (Zimbra), sans que cela crée de
dépendance côté hébergement.

### 8.3 Clever Cloud — PaaS, zéro ops

Clever Cloud (Nantes) propose un service **entièrement managé** :

  - Tu fais `git push`, c'est en ligne. Plus de serveur à gérer.
  - Plus cher : ~60-80 €/mois minimum pour notre stack (vs ~15 €
    chez Scaleway).
  - Maintenance OS, mises à jour de sécurité, redémarrages,
    backups → tout est inclus.

À considérer plus tard, quand le revenu permet de payer pour
gagner du temps sur l'ops.

### 8.4 Hetzner — EU mais pas français

Hetzner (Allemagne) :

  - **3× moins cher** que Scaleway (~5 €/mois pour l'équivalent
    du DEV1-M).
  - Hardware moderne, console correcte, support en anglais.
  - Pas français → on perd l'argument « données hébergées en
    France » même si c'est techniquement de l'UE.

À choisir uniquement si le budget est ultra serré et qu'on
assume le compromis.

### 8.5 Récapitulatif — quelle option pour quel besoin

  Scaleway      → retenu pour Buildr, en place.
  OVHcloud      → si on veut le label « 100 % français » et
                  viser le secteur public (SecNumCloud).
  Clever Cloud  → plus tard, pour décharger toute l'ops.
  Hetzner       → uniquement si budget ultra serré, EU pas FR.
  o2switch      → seulement pour un blog WordPress séparé,
                  jamais pour héberger l'app Buildr.

Voir aussi `docs/EMAIL.md` et `docs/DEPLOYMENT-PLAN.md`.
