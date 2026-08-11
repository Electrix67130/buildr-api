# Buildr — Plan de déploiement complet

Guide pas-à-pas pour mettre en production toutes les apps Buildr.

**Ordre recommandé :**
1. App mobile sur **App Store** (Apple) + **Google Play** (Android)
2. **Site vitrine** (`getbuildr.fr`)
3. **Dashboard web** (`app.getbuildr.fr`)

> **Phase beta : 6 premiers mois gratuits**
> Pas d'intégration paiement au lancement. Buildr est en **beta publique gratuite** jusqu'à une date commune fixée par l'éditeur (cible : ≈ 6 mois après le launch). Ce n'est **pas un essai gratuit individuel de 6 mois** : tous les Utilisateurs ont accès gratuitement jusqu'à la même date de fin de beta, peu importe quand ils ont rejoint. Stripe et la facturation par siège sont reportés à la sortie de beta. Cela simplifie énormément le launch : pas de Stripe, pas de CGV à durcir, pas de webhooks paiement, pas de TVA à gérer immédiatement.

---

## Phase 0 — Prérequis communs (à faire AVANT tout)

Sans ces éléments, tu ne peux rien soumettre.

### 0.1 — Statut juridique
**Pendant la beta gratuite (6 mois) : société NON obligatoire.** Pas de revenu = pas de besoin de structure juridique côté Code de commerce. Tu peux publier en **nom propre** comme particulier sur les deux stores.

Trois options par ordre de complexité :

| Option | Coût | Délai | Quand l'utiliser |
|---|---|---|---|
| **Nom propre (particulier)** | 0 € | immédiat | Beta gratuite, tu testes le marché |
| **Auto-entrepreneur (micro-entreprise)** | 0 € | 1-2 semaines en ligne | Tu veux pouvoir facturer dès la sortie de beta sans recréer ta config stores |
| **SASU / SAS / SARL** | ~200-500 € + compta | 2-4 semaines | Tu lèves des fonds, tu embauches, tu veux limiter ta responsabilité |

**Recommandation pour Buildr** : démarrer en **auto-entrepreneur** dès maintenant. C'est gratuit, ça prend 30 min en ligne sur `autoentrepreneur.urssaf.fr`, et ça te donne :
- Un SIRET utilisable pour le D-U-N-S Number
- La possibilité d'encaisser dès la fin de la beta sans repartir de zéro
- Un cadre fiscal clair (pas de TVA jusqu'à 36 800 € de CA)
- Plus crédible aux yeux des clients BTP qu'un particulier

Tu pourras toujours passer en SASU plus tard quand le CA augmente.

**À avoir au minimum :**
- [ ] SIRET (auto-entrepreneur suffit) — ou nom propre si tu démarres ultra léger
- [ ] Adresse postale (peut être ton domicile)
- [ ] RIB (perso ou pro)

### 0.2 — Domaine + emails
- [ ] Domaine `getbuildr.fr` acheté (OVH, Gandi, Cloudflare ~10€/an)
- [ ] Email pro `contact@getbuildr.fr` (Google Workspace ~6€/mois ou OVH ~3€/mois)
- [ ] Email `support@getbuildr.fr` (peut être un alias)
- [ ] Email `legal@getbuildr.fr` ou `dpo@getbuildr.fr` (RGPD)

### 0.3 — Documents légaux (obligatoires sur les stores ET le site)
Tu as déjà les drafts dans `docs/` :
- [ ] `CGU.md` → finaliser (obligatoire dès le lancement)
- [ ] `PRIVACY.md` → finaliser (obligatoire — Apple/Google la demandent)
- [ ] `MENTIONS-LEGALES.md` → finaliser (obligatoire)
- [ ] `CGV.md` → **peut attendre la fin de la beta gratuite** (pas obligatoire tant qu'il n'y a pas de vente). Mentionner dans les CGU que "le service est offert gratuitement pendant la phase beta"

**Action requise** : ces docs doivent être accessibles en HTML publics (sur le site vitrine ou hébergement statique temporaire) AVANT la soumission aux stores. Apple/Google demandent une URL de politique de confidentialité.

### 0.4 — Déclaration CNIL (RGPD)
- [ ] Tenir un **registre des traitements** (obligatoire dès le premier user)
- [ ] Nommer un DPO (peut être toi-même)
- [ ] Pas de déclaration formelle à faire (supprimée depuis 2018), mais le registre doit être prêt en cas de contrôle

### 0.5 — API en production

**C'est le prérequis bloquant n°1** : Apple ET Google testent réellement le login pendant la review. L'API doit tourner sur `api.getbuildr.fr` AVANT de soumettre quoi que ce soit. Détail de l'hébergement dans `HOSTING.md`.

> ⚠️ Ne jamais builder l'app mobile contre un tunnel jetable (`*.trycloudflare.com`, ngrok) : dès que le tunnel tombe, le build en review est cassé → rejet.

#### Architecture retenue (beta)
Cloudflare (HTTPS public, **mode Full**) → Caddy (TLS interne self-signed) → API Fastify → PostgreSQL. Tout en Docker Compose sur un seul serveur Scaleway. Les uploads sont stockés sur un **volume disque persistant** (le mode S3 n'est pas encore codé — à faire avant de scaler).

#### Fichiers de déploiement (déjà présents dans le repo)
- `docker-compose.prod.yml` — stack prod (Caddy + API + Postgres), volumes persistants, `restart: unless-stopped`, base non exposée à l'extérieur
- `Caddyfile` — reverse proxy `api.getbuildr.fr`, `tls internal`, WebSocket (temps réel)
- `.env.production.example` — template de toutes les variables prod
- `scripts/backup-db.sh` — dump DB quotidien + rotation 30 jours

#### Checklist infra (manuel)
- [ ] Domaine `getbuildr.fr` acheté + ajouté à **Cloudflare**
- [ ] Cloudflare → SSL/TLS → mode **Full** (⚠️ pas Flexible)
- [ ] Serveur **Scaleway DEV1-M** (Paris, Ubuntu 24.04), clé SSH ajoutée
- [ ] DNS Cloudflare : `A` record `api` → IP serveur, **Proxied** (nuage orange)
- [ ] **Resend** : domaine `getbuildr.fr` ajouté, 3 DNS records dans Cloudflare, API Key créée
- [ ] Docker installé sur le serveur : `curl -fsSL https://get.docker.com | sh`

#### Secrets à générer (`openssl rand -hex 32`)
- [ ] `JWT_SECRET`, `API_KEY`, `CALENDAR_ENCRYPTION_KEY` (hex 32)
- [ ] `DB_PASSWORD` (`openssl rand -hex 24`)
- [ ] ⚠️ `API_KEY` doit être **identique** à `EXPO_PUBLIC_API_KEY` dans l'app mobile

#### Mise en ligne
```bash
git clone <repo> buildr-api && cd buildr-api
cp .env.production.example .env.production
nano .env.production          # coller secrets + clé Resend

# ⚠️ toujours --env-file .env.production (sinon les ${DB_*} ne sont pas interpolés)
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml exec buildr-api npm run migrate
```

#### Vérification + backup
- [ ] `https://api.getbuildr.fr/health` → `{"status":"ok"}`, cadenas HTTPS OK
- [ ] Cron backup (`crontab -e`) :
  ```
  0 3 * * * cd /chemin/buildr-api && ./scripts/backup-db.sh >> ./backups/backup.log 2>&1
  ```

---

## Phase 1 — Déploiement App Store (iOS)

**Durée estimée :** 1-2 semaines (dont 24-48h de review Apple)
**Coût :** 99 €/an

### 1.1 — Compte Apple Developer

Deux choix selon ton statut juridique :

**Option A — Individual (recommandée pour la beta)**
- Ton nom personnel apparaît comme éditeur sur l'App Store (ex: "Julien Schubnel")
- **Pas besoin de D-U-N-S Number** → inscription en 24-48h
- 99 €/an
- Limite : tu seras seul à gérer l'app (pas de gestion d'équipe en multi-comptes)
- Tu peux passer en Organization plus tard, MAIS le transfert d'app est complexe (mieux vaut le faire avant d'avoir beaucoup d'users)

**Option B — Organization**
- Nom de société sur l'App Store (ex: "Buildr SAS")
- Requiert un D-U-N-S Number gratuit : https://developer.apple.com/enroll/duns-lookup/
- Délai D-U-N-S : 1 à 14 jours (2-3 jours pour une SASU/SARL française, plus long pour auto-entrepreneur)
- 99 €/an
- Permet d'inviter plusieurs développeurs sur le compte

Étapes :
- [ ] Créer un Apple ID dédié (`developer@getbuildr.fr` ou ton perso pour démarrer)
- [ ] S'inscrire au **Apple Developer Program** : https://developer.apple.com/programs/
- [ ] Choisir Individual OU Organization selon ton statut
- [ ] (Si Organization) demander le D-U-N-S Number
- [ ] Payer les 99 €/an (CB)
- [ ] Validation Apple : 1 à 5 jours ouvrés

> **Astuce** : si tu démarres en nom propre pour la beta, prends Individual → tu gagnes 2 semaines d'attente. Si tu sais déjà que tu vas passer en SASU dans les 6 mois, attends la création de la société et prends directement Organization (évite la migration pénible).

### 1.2 — Préparer l'app mobile
Dans `buildr-ui/` :

- [ ] Vérifier `app.json` :
  - [ ] Ajouter `"bundleIdentifier": "fr.getbuildr.app"` dans `ios`
  - [ ] Ajouter `"package": "fr.getbuildr.app"` dans `android`
  - [ ] Incrémenter `version` (ex: `1.0.0`)
  - [ ] Ajouter `"buildNumber": "1"` (iOS) et `"versionCode": 1` (Android)
- [ ] Tester l'app de bout en bout (login, création chantier, photo, etc.)
- [ ] Vérifier que toutes les `infoPlist` permissions sont bien justifiées (déjà OK dans `app.json`)
- [ ] Configurer `EXPO_PUBLIC_API_URL=https://api.getbuildr.fr` pour le build prod

### 1.3 — Assets visuels (App Store Connect)
À préparer en amont (Figma / Photoshop) :

- [ ] **Icône app** : 1024×1024 PNG, sans transparence, sans bords arrondis
- [ ] **Screenshots iPhone** : 6.7" (1290×2796) — au moins 3, max 10
- [ ] **Screenshots iPad** (si supportTablet) : 12.9" (2048×2732)
- [ ] **Description courte** (170 caractères max)
- [ ] **Description longue** (4000 caractères max)
- [ ] **Mots-clés** (100 caractères max, séparés par virgules)
- [ ] **URL support** : `https://getbuildr.fr/support`
- [ ] **URL politique de confidentialité** : `https://getbuildr.fr/privacy`
- [ ] Catégorie : **Business** ou **Productivity**
- [ ] Note d'âge : 4+ (probablement)

### 1.4 — Build avec EAS Build
Expo a son service de build cloud (gratuit jusqu'à 30 builds/mois) :

```bash
cd buildr-ui
npm install -g eas-cli
eas login
eas build:configure
eas build --platform ios --profile production
```

- [ ] Configurer `eas.json` avec profil `production`
- [ ] EAS génère les certificats Apple automatiquement (login Apple Developer requis)
- [ ] Le build prend 15-30 min, output = fichier `.ipa`

### 1.5 — Soumission App Store Connect
- [ ] Aller sur https://appstoreconnect.apple.com
- [ ] Créer une nouvelle app (bundle ID = `fr.getbuildr.app`)
- [ ] Uploader le `.ipa` (via EAS Submit ou Transporter.app)
  ```bash
  eas submit --platform ios
  ```
- [ ] Remplir toutes les métadonnées (description, screenshots, URLs)
- [ ] Répondre au **questionnaire de conformité** (chiffrement, contenus, etc.)
- [ ] Configurer **TestFlight** pour beta-tester avant release publique
- [ ] Soumettre pour review

### 1.6 — Review Apple
- [ ] Délai moyen : **24-48h** (parfois plus)
- [ ] Si rejet : lire le message, corriger, resoumettre. Causes fréquentes :
  - Crash au lancement
  - Permissions sans justification claire
  - Bug dans le login (Apple teste TOUJOURS le login → fournir un compte de test)
  - Mention de "beta" ou "test" dans la description
- [ ] **Fournir un compte de démo** dans App Store Connect (login + password) → obligatoire si login requis

### 1.7 — Release
- [ ] Choisir "Release manuel" pour contrôler le moment du go-live
- [ ] Une fois approuvée : 1 clic pour mettre en ligne
- [ ] Disponible mondialement en 1-2h

---

## Phase 2 — Déploiement Google Play (Android)

**Durée estimée :** 1 semaine (dont 1-3 jours de review)
**Coût :** 25 $ une fois (à vie)

### 2.1 — Compte Google Play Console
- [ ] Créer un compte Google dédié (`developer@getbuildr.fr` ou ton perso)
- [ ] S'inscrire à **Google Play Console** : https://play.google.com/console/signup
- [ ] Choisir **Personal** (beta sans société) ou **Organization** (si SASU déjà créée)
  - Personal : ton nom personnel comme éditeur, vérification d'identité simple
  - Organization : nom de société, requiert un justificatif d'immatriculation
- [ ] Payer 25 $ (CB, une seule fois)
- [ ] **Vérification d'identité requise** (depuis 2023) : pièce d'identité (+ justificatif société si Organization)
- [ ] Délai validation : quelques heures à 2 jours

### 2.2 — Assets visuels (Play Console)
- [ ] **Icône** : 512×512 PNG
- [ ] **Bannière feature** : 1024×500 PNG
- [ ] **Screenshots téléphone** : min 2, max 8 (résolution libre, 16:9 ou 9:16)
- [ ] **Screenshots tablette 7"** (optionnel mais recommandé)
- [ ] **Description courte** (80 caractères)
- [ ] **Description longue** (4000 caractères)
- [ ] **URL politique de confidentialité**
- [ ] **Email de contact**
- [ ] Catégorie : **Business** ou **Productivity**

### 2.3 — Build Android (AAB)
Google Play exige le format **AAB** (Android App Bundle), pas APK :

```bash
cd buildr-ui
eas build --platform android --profile production
```

- [ ] EAS génère le keystore automatiquement (ne JAMAIS le perdre — c'est la signature de ton app à vie)
- [ ] Output = fichier `.aab`

### 2.4 — Soumission Play Console
- [ ] Créer une nouvelle app dans Play Console
- [ ] Remplir le **questionnaire de classification de contenu** (IARC)
- [ ] Remplir le **questionnaire de sécurité des données** (très détaillé — quelles données, où, partagées avec qui)
- [ ] Uploader le `.aab` dans le canal **Production**
- [ ] OU faire un **test interne / fermé** d'abord (recommandé)
  ```bash
  eas submit --platform android
  ```

### 2.5 — Review Google
- [ ] Délai : **1 à 7 jours** (souvent 24-48h pour une première soumission)
- [ ] **Nouveauté 2023+** : Google demande **12 testeurs minimum** pendant 14 jours pour une release production sur un nouveau compte
  - [ ] Soit faire un test fermé avec 12 personnes (famille, amis, beta-users)
  - [ ] Soit passer par un test ouvert
- [ ] Une fois validée : disponible dans Play Store en quelques heures

---

## Phase 3 — Site vitrine (`getbuildr.fr`)

**Durée estimée :** 2-3 jours (le site existe déjà, il manque les pages légales + déploiement)
**Coût hébergement :** gratuit (Vercel) à 20€/mois

> **Statut actuel** : repo `buildr-website` déjà initialisé avec Next.js 16 + Tailwind v4 + i18n.
> Pages existantes : `/`, `/features`, `/how-it-works`, `/pricing`, `/contact`.
> Il reste à ajouter les pages légales et déployer.

### 3.1 — Stack en place
- Next.js 16 + Tailwind v4 + i18n + lucide-react
- Repo : `buildr-website`
- Hébergement cible : **Vercel** (gratuit, intégration Git, déploiement auto)

### 3.2 — Pages à ajouter (manquantes)
- [ ] **CGU** (`/cgu` ou `/legal/cgu`) → render le contenu de `docs/CGU.md`
- [ ] **Politique de confidentialité** (`/privacy`) → render `docs/PRIVACY.md`
- [ ] **Mentions légales** (`/mentions-legales`) → render `docs/MENTIONS-LEGALES.md`
- [ ] **Support** (`/support`) → email `support@getbuildr.fr` + FAQ basique (URL exigée par Apple)
- [ ] ~~CGV~~ → reportée à la fin de la beta gratuite
- [ ] **404** custom (si pas déjà fait)

### 3.3 — Pages existantes à reviewer avant le launch
- [ ] **Accueil** : adapter le wording "beta gratuite 6 mois"
- [ ] **Pricing** : afficher "Beta gratuite — facturation à partir de [date]" plutôt que "10€/siège"
- [ ] **Features** : cohérence avec ce qui marche réellement dans l'app mobile
- [ ] **How-it-works** : vérifier que les screenshots correspondent à la version soumise aux stores
- [ ] **Contact** : tester le formulaire → email `contact@getbuildr.fr`
- [ ] **Footer** : ajouter les liens vers les 3 pages légales (obligatoire LCEN)

### 3.3 — SEO + tracking
- [ ] `sitemap.xml` + `robots.txt`
- [ ] Open Graph tags (preview Facebook/LinkedIn/Twitter)
- [ ] Google Search Console : soumettre le sitemap
- [ ] **Analytics RGPD-friendly** : Plausible (~9€/mois) ou Umami self-hosted (gratuit)
- [ ] Si Google Analytics : bannière cookies obligatoire

### 3.4 — Déploiement
- [ ] Push sur GitHub
- [ ] Connecter le repo à Vercel
- [ ] Configurer le domaine `getbuildr.fr` dans Vercel
- [ ] DNS chez ton registrar :
  - `A` record `@` → IP Vercel
  - `CNAME` `www` → `cname.vercel-dns.com`
- [ ] Certificat HTTPS auto (Vercel)
- [ ] Vérifier en prod avant de poser des backlinks

---

## Phase 4 — Dashboard web (`app.getbuildr.fr`)

**Durée estimée :** selon la complexité (déjà partiellement développé ?)
**Coût hébergement :** gratuit (Vercel) à 20€/mois

### 4.1 — Stack
- Next.js 16 + Tailwind v4 + TanStack Query (cf. `LAUNCH-PLAN.md`)
- Repo : `buildr-dashboard`
- Hébergement : **Vercel**

### 4.2 — Pré-requis fonctionnels
Ce que le dashboard doit minimum offrir au launch :

- [ ] Login (réutilise `/auth/login` de l'API)
- [ ] Gestion organisation (membres, rôles)
- [ ] Liste + détail des chantiers (vue bureau)
- [ ] Gestion des photos / documents (téléchargement bulk)
- [ ] Page `/billing` : calcul HT en temps réel (10€/siège facturable)
- [ ] Super admin (si activé via `SUPER_ADMIN_EMAILS`)

### 4.3 — Intégration paiement (REPORTÉ à la fin de la beta publique)
**Pas nécessaire au launch.** Pendant la beta publique (gratuite pour tous jusqu'à une date commune), le dashboard affiche simplement "Beta publique gratuite — facturation à partir du JJ/MM/AAAA" sur la page `/billing`. Le même message s'affiche pour tous les Utilisateurs, qu'ils aient rejoint hier ou il y a 5 mois.

À faire avant la fin de la beta :
- [ ] Stripe en mode test d'abord
- [ ] Stripe Billing pour la facturation par siège
- [ ] Webhooks Stripe → API (`/billing/webhook`)
- [ ] Génération factures PDF
- [ ] CGV finalisées et acceptées par les users avant la première facturation
- [ ] Email d'annonce 30 jours avant la fin de la beta

### 4.4 — Déploiement
- [ ] Variable d'env `NEXT_PUBLIC_API_URL=https://api.getbuildr.fr`
- [ ] Repo connecté à Vercel
- [ ] Sous-domaine `app.getbuildr.fr` configuré
- [ ] CORS API : autoriser `https://app.getbuildr.fr`
- [ ] Test du flow complet : signup → chantier → invitation membre

---

## Phase 5 — Post-launch

### 5.1 — Monitoring
- [ ] **Sentry** (gratuit jusqu'à 5k events/mois) → erreurs front + back
- [ ] **Uptime** : UptimeRobot ou Better Stack (gratuit)
- [ ] **Logs API** : Axiom, Logtail, ou stdout sur le VPS
- [ ] Alerting Slack ou email si l'API tombe

### 5.2 — Support utilisateur
- [ ] Adresse `support@getbuildr.fr` qui répond sous 24-48h
- [ ] Optionnel : Crisp / Intercom chat (gratuit jusqu'à un certain volume)
- [ ] FAQ sur le site vitrine

### 5.3 — Mises à jour app mobile
- À chaque release :
  - [ ] Incrémenter `version` et `buildNumber` / `versionCode` dans `app.json`
  - [ ] `eas build` + `eas submit` pour chaque plateforme
  - [ ] Review Apple : ~24h, Google : ~quelques heures
- **EAS Update** (OTA) : pour les fixes JS sans repasser par le store (gratuit jusqu'à 1000 MAU)

---

## Récapitulatif coûts annuels (estimation)

| Poste | Coût annuel |
|---|---|
| Domaine `getbuildr.fr` | ~10 € |
| Email pro (Google Workspace) | ~70 € |
| Apple Developer Program | 99 € |
| Google Play (one-shot) | ~23 € (la 1ère année) |
| VPS API + DB managed | ~180 € (15€/mois) |
| Stockage S3 photos | ~12-50 € |
| Vercel (vitrine + dashboard) | 0 € (tier gratuit suffit au début) |
| Analytics (Plausible) | ~108 € |
| Sentry | 0 € (tier gratuit) |
| **TOTAL année 1** | **~500-600 €** |

Hors abonnements optionnels (Crisp, Intercom, etc.).

---

## Ordre d'exécution conseillé (version beta)

```
Semaine 1  → Auto-entrepreneur OU nom propre, domaine, email pro, compte Apple Individual, compte Google
Semaine 2  → API en prod, docs légaux finalisés (CGU + Privacy + Mentions), pages légales ajoutées au site vitrine
Semaine 3  → Site vitrine déployé sur getbuildr.fr, build iOS + soumission App Store
Semaine 4  → Build Android + soumission Google Play (test fermé 12 users en parallèle)
Semaine 5  → Onboarding des premiers partenaires beta sur l'app mobile
Semaine 6+ → Dashboard web (sans paiement)
Mois 5-6   → Préparation sortie de beta : CGV, Stripe, communication aux users
```

**Chemin critique :**
- **12 testeurs Android pendant 14 jours** (depuis 2023, obligatoire sur nouveau compte Play) → démarrer le recrutement dès semaine 1
- **Compte Apple Individual** : 24-48h de validation, pas besoin de D-U-N-S → bloquant léger
- **API en prod** : doit tourner avant la soumission des apps (les reviewers d'Apple testent réellement le login)
