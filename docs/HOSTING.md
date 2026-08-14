# Buildr — Plan d'hébergement

Document de référence pour savoir où héberger quoi, combien ça coûte,
et comment configurer Cloudflare.

**Dernière mise à jour :** 14 mai 2026
**Phase ciblée :** beta (1 à 3 entreprises partenaires)
**Domaine retenu :** `getbuildr.fr`

---

## 1. Vue d'ensemble

L'écosystème Buildr est composé de 4 applications. Pour la phase beta,
elles tournent toutes sur **un seul serveur** chez Scaleway, derrière
Cloudflare qui s'occupe du domaine et de la sécurité.

```
                        Cloudflare
                  (DNS + HTTPS + cache + anti-DDoS)
                           │
            ┌──────────────┼──────────────┐
            │              │              │
    getbuildr.fr   app.getbuildr.fr  api.getbuildr.fr
       (vitrine)      (dashboard)        (API)
            │              │              │
            └──────────────┼──────────────┘
                           ▼
              ┌─────────────────────────┐
              │  Serveur Scaleway       │
              │  Paris, France          │
              │  (Docker Compose)       │
              │  ─────────────────────  │
              │  - API Buildr           │
              │  - Base PostgreSQL      │
              │  - Dashboard web        │
              │  - Site vitrine         │
              └──────────┬──────────────┘
                         │
                         ▼
              ┌─────────────────────────┐
              │  Scaleway Object        │
              │  Storage Paris          │
              │  (photos chantier,      │
              │   documents, backups)   │
              └─────────────────────────┘

Email transactionnel : Resend
```

---

## 2. Scaleway — l'hébergeur principal

**Pourquoi Scaleway :** entreprise française (groupe Iliad/Free),
data centers en France (Paris), console et facture en français, prix
corrects, conformité RGPD native.

### 2.1 Ce qu'il faut prendre

Trois services suffisent pour démarrer.

**A. Le serveur (Virtual Instances — gamme Development)**

  Produit : **DEV1-M**
  Caractéristiques : 3 vCPU, 4 Go RAM, 40 Go SSD
  Région : Paris (par)
  Coût : ~14 €/mois

  C'est là que tournent : l'API, la base de données, le dashboard web,
  et le site vitrine. Tout est isolé dans Docker.

  Pourquoi pas plus petit : on a besoin d'au moins 4 Go de RAM pour
  faire tourner PostgreSQL confortablement à côté de Node.

  Pourquoi pas plus gros : à 1-3 entreprises, c'est largement suffisant.
  On évalue de monter en taille (PRO2-XXS, ~24 €/mois) quand on
  approchera des 10 entreprises.

**B. Le stockage des photos et documents (Object Storage)**

  Produit : **Object Storage**, gamme **Standard**
  Région : Paris (par)
  Coût : 75 Go gratuits, puis ~0,015 €/Go/mois

  Compatible API S3 — c'est-à-dire que le code de l'application
  l'utilise comme un dossier en ligne, sans dépendre d'un fournisseur
  spécifique. On peut migrer ailleurs plus tard si besoin.

  Ce qu'on y met :
  - Toutes les photos prises sur les chantiers
  - Les documents (DICT, plans, factures, arrêtés…)
  - Les sauvegardes quotidiennes de la base de données

  Tant qu'on reste sous 75 Go, c'est gratuit. Pour donner un ordre
  d'idée : ça représente environ 15 000 photos en qualité moyenne, ou
  30 000 photos compressées.

**C. Le nom de domaine (Domains)**

  Domaine retenu : **getbuildr.fr**
  Coût : ~8-10 €/an

  Le `.fr` ancre le projet sur le marché BTP français et appuie le
  discours "données hébergées en France". Le préfixe `get` est un
  pattern startup éprouvé (getsentry, getmagic, getlago) et reste
  facile à dicter au téléphone à un client BTP.

  Où l'acheter (ordre indifférent, mêmes prix) :
  - **Cloudflare Registrar** : à prix coûtant, paiement en USD.
  - **OVH** : 100 % français, paiement en euros.
  - **Gandi** : sérieux, console agréable.
  - **Scaleway Domains** : pratique si on veut tout centraliser.

  Le nom principal `buildr.fr` est déjà pris ; on pourra tenter de
  le racheter plus tard si l'occasion se présente. En attendant,
  il est sage de locker `usebuildr.fr` (~9 €/an) pour qu'un
  concurrent ne phishe pas.

### 2.2 Ce qu'il ne faut PAS prendre (pour l'instant)

Scaleway propose une cinquantaine de produits, voici ceux à ignorer
pour ne pas se disperser :

  - **Bare Metal / Dedibox / Elastic Metal** : serveurs physiques
    dédiés. Trop puissant et trop rigide pour la phase beta. À
    réévaluer quand on dépassera 50 entreprises clientes.
  - **Managed Database PostgreSQL** : base de données gérée par
    Scaleway (~14 €/mois). Utile quand on veut décharger la
    maintenance, mais pour l'instant la base tourne dans Docker à
    côté de l'app — c'est plus simple et gratuit.
  - **Kubernetes (Kapsule)** : orchestration de containers à grande
    échelle. Pas nécessaire tant qu'on est sur un seul serveur.
  - **Serverless Functions / Containers / Jobs** : exécution à la
    demande. Pas adapté à un serveur qui doit rester allumé en
    permanence (WebSocket temps réel).
  - **GPU / AI** : pas de besoin de calcul intensif.
  - **Load Balancer** : utile uniquement si on met plusieurs serveurs
    en parallèle.
  - **Virtual Private Cloud (VPC)** : utile uniquement avec plusieurs
    serveurs à isoler.
  - **Secret Manager** : un fichier `.env` chiffré fait le job au
    départ.

### 2.3 Coût Scaleway phase beta

  Serveur DEV1-M             14,00 €/mois
  Object Storage (< 75 Go)    0,00 €/mois
  Domaine getbuildr.fr        0,75 €/mois (~9 €/an lissé)
  ────────────────────────────────────────
  TOTAL Scaleway             ~15 €/mois

---

## 3. Cloudflare — la couche réseau

**Cloudflare est un service gratuit qui se place entre Internet et ton
serveur.** Il joue 4 rôles à la fois, et c'est l'astuce qui fait gagner
du temps, de l'argent et de la sécurité.

### 3.1 Les 4 rôles de Cloudflare

**A. DNS (l'annuaire d'Internet)**

  Quand quelqu'un tape **getbuildr.fr** dans son navigateur, son
  ordinateur a besoin de savoir à quelle adresse IP envoyer la
  requête. Cloudflare répond à cette question en quelques
  millisecondes, partout dans le monde.

  C'est gratuit, et c'est plus rapide que les DNS de la plupart des
  registrars classiques.

**B. HTTPS / SSL (le petit cadenas dans le navigateur)**

  Pour que les utilisateurs voient « cadenas vert » dans leur
  navigateur, le site doit avoir un certificat SSL. Cloudflare en
  génère un automatiquement et le renouvelle tout seul tous les
  3 mois. **Tu n'as rien à faire.**

  Sans Cloudflare, il faudrait gérer Let's Encrypt soi-même sur le
  serveur (faisable, mais une chose en moins à maintenir).

**C. CDN (cache mondial)**

  Cloudflare a des serveurs partout dans le monde (Paris, New York,
  Tokyo, Sydney…). Quand quelqu'un visite **getbuildr.fr** depuis Lyon,
  Cloudflare lui sert la page depuis Paris. Depuis Montréal, depuis
  son nœud de Montréal.

  Résultat : le site charge en 100 ms partout au lieu de 500 ms si
  on devait toujours interroger le serveur à Paris.

  Pour la vitrine et le dashboard, le gain est immédiat.

  Quand quelqu'un visite **getbuildr.fr** depuis Lyon, Cloudflare
  lui sert la page depuis Paris (ou Marseille). Depuis Montréal,
  depuis le nœud de Montréal.

**D. Anti-DDoS et bot protection**

  Si quelqu'un essaie d'attaquer le site avec des milliers de
  requêtes par seconde, Cloudflare absorbe et filtre. C'est inclus
  gratuitement.

  Sans Cloudflare, ce sont les ressources de ton serveur Scaleway
  qui sautent en premier.

### 3.2 Pourquoi c'est mieux que les DNS du registrar

Quand on achète un nom de domaine chez Scaleway, OVH ou Gandi, ils
fournissent leurs propres DNS. Ça marche, mais :
  - Pas de CDN intégré.
  - Pas d'anti-DDoS gratuit.
  - Certificats SSL à gérer soi-même.
  - DNS souvent plus lents que ceux de Cloudflare.

**Cloudflare = un seul service qui fait les 4 choses, gratuitement.**

### 3.3 Comment ça se met en place

Étapes côté Cloudflare (~15 minutes une fois pour toutes) :

  1. Créer un compte sur cloudflare.com (gratuit).
  2. Cliquer « Add a site » et taper **getbuildr.fr**.
  3. Cloudflare scanne les DNS actuels et propose une configuration.
  4. Cloudflare donne 2 adresses de « nameservers » (du style
     `dana.ns.cloudflare.com` et `tim.ns.cloudflare.com`).
  5. Aller chez le registrar (Scaleway / OVH / Gandi) et changer les
     nameservers du domaine pour ceux de Cloudflare. Ça prend 1 à
     24 h à se propager.
  6. Une fois fait, c'est Cloudflare qui gère.

Étapes côté DNS (les enregistrements à créer dans Cloudflare) :

  - **getbuildr.fr** → adresse IP du serveur Scaleway
    (le site vitrine répondra à cette adresse)
  - **app.getbuildr.fr** → adresse IP du serveur Scaleway
    (le dashboard répondra à cette adresse)
  - **api.getbuildr.fr** → adresse IP du serveur Scaleway
    (l'API répondra à cette adresse)

Le serveur Scaleway, lui, sait grâce à un reverse proxy (Caddy)
quel domaine renvoyer vers quelle application.

### 3.4 Coût Cloudflare

  Plan **Free** suffit pour la beta. Inclus :
  - DNS illimité
  - SSL automatique
  - CDN mondial
  - Anti-DDoS basique
  - 100 000 requêtes/jour sur les fonctions (largement assez)

  Coût : **0 €/mois**.

  Plus tard, si on a besoin de fonctions avancées (règles de cache
  fines, analytics détaillées), le plan Pro est à 20 €/mois — mais
  on n'en aura pas besoin avant longtemps.

---

**E. Email Routing (bonus gratuit)**

  Avant que Resend soit en place, tu peux activer **Email Routing**
  dans Cloudflare pour rediriger `contact@getbuildr.fr` vers ta
  boîte perso. Tu communiques une adresse pro dès le premier jour,
  sans serveur mail à gérer. Configuration : 2 minutes.

---

## 4. Resend — les emails transactionnels

Quand l'app envoie un email (invitation, reset mot de passe,
notification), elle passe par un service tiers qui s'occupe de la
délivrance — sinon les emails partent dans les spams.

**Produit recommandé : Resend** (alternative à Mailgun / SendGrid).

  Coût : 0 € jusqu'à 3 000 emails / mois
  Au-delà : ~20 €/mois pour 50 000 emails

  Configuration : 3 enregistrements DNS à ajouter dans Cloudflare
  (Resend les fournit copier-coller). 5 minutes à mettre en place.

---

## 5. Sauvegardes

  - **Base de données** : sauvegarde automatique tous les jours à 3h
    du matin, envoyée vers Scaleway Object Storage. Conservation de
    30 jours.
  - **Photos / documents** : déjà stockés dans Object Storage, qui
    est redondé par Scaleway sur 3 sites.
  - **Code de l'application** : sur GitHub (déjà fait).

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

  Serveur Scaleway DEV1-M      14,00 €
  Object Storage                0,00 € (< 75 Go gratuits)
  Domaine getbuildr.fr          0,75 €  (~9 €/an lissé)
  Cloudflare                    0,00 €
  Resend                        0,00 € (< 3 000 emails/mois)
  Apple Developer (lissé)       8,00 € (99 €/an)
  ──────────────────────────────────────
  TOTAL                       ~23 €/mois

  Phase « scale » (10 à 50 entreprises) :
  - Serveur passe à PRO2-XXS (24 €/mois)
  - Object Storage commence à coûter (~5 €/mois pour 500 Go)
  - Base de données peut migrer vers Managed Database (~14 €/mois)
  - Total estimé : ~60 €/mois

  Phase « mature » (100+ entreprises) : voir LAUNCH-PLAN.txt section 5.

---

## 7. Ordre des achats à faire

À enchaîner dans cet ordre :

  1. Créer un compte Scaleway (compte personnel suffit au début, ou
     direct compte entreprise si l'auto-entreprise / société existe).
  2. Acheter le domaine **getbuildr.fr** chez Scaleway (ou
     Cloudflare Registrar direct si tu préfères tout regrouper).
  3. Créer un compte Cloudflare et y ajouter le domaine.
  4. Changer les nameservers chez le registrar pour ceux de
     Cloudflare. Attendre quelques heures la propagation.
  5. Provisionner le serveur **DEV1-M** à Scaleway, région Paris.
  6. Créer un **Object Storage bucket** à Scaleway, région Paris.
  7. Créer un compte **Resend**, ajouter le domaine, mettre les
     3 enregistrements DNS dans Cloudflare.
  8. Déployer l'application sur le serveur (script Docker Compose
     fourni séparément).
  9. Pointer les 3 sous-domaines dans Cloudflare vers le serveur.
  10. Vérifier que tout répond, configurer le cron de sauvegarde.

Temps estimé total : une demi-journée à une journée.

---

## 8. Comparaison avec les autres hébergeurs

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
commercial fort pour tes premiers clients.

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

  Scaleway      → recommandé pour Buildr, maintenant.
  OVHcloud      → si on veut le label « 100 % français » et
                  viser le secteur public (SecNumCloud).
  Clever Cloud  → plus tard, pour décharger toute l'ops.
  Hetzner       → uniquement si budget ultra serré, EU pas FR.
  o2switch      → seulement pour un blog WordPress séparé,
                  jamais pour héberger l'app Buildr.


=== FIN DU DOCUMENT ===
