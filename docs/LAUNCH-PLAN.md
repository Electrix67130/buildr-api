# Buildr — Plan de mise en production

Document de référence pour le lancement de Buildr. Rassemble la stratégie produit, la pricing,
le plan de déploiement, les coûts, les obligations légales et la roadmap super admin.

**Dernière mise à jour :** 11 mai 2026
**Statut :** Beta privée avec partenaires — pas encore de signup public

---

## 1. Vision produit

Buildr est un SaaS B2B de gestion de chantiers pour le BTP, composé de **4 applications** :

| Repo | Rôle | Stack |
|---|---|---|
| `buildr-api` | API REST, source de vérité | Fastify + Postgres + Knex + Zod + TypeScript |
| `buildr-ui` | App mobile (iOS + Android) — terrain | Expo + React Native + TypeScript |
| `buildr-dashboard` | Web app authentifiée — bureau + super admin | Next.js 16 + Tailwind v4 + TanStack Query |
| `buildr-website` | Vitrine publique — acquisition | Next.js 16 + Tailwind v4 |

Domaines :
- `getbuildr.fr` → vitrine
- `app.getbuildr.fr` → dashboard web
- `api.getbuildr.fr` → API

---

## 2. Business model & pricing

### Plan Pro (pay-per-seat)

**10€ HT / membre facturable / mois**

Sont facturés : rôles `admin`, `manager`, `employee` dans une organisation.
Sont **gratuits** : `client`, `gestionnaire_reseau` (acteurs externes).

Calcul automatique côté dashboard `/billing` : `total_HT = nb_facturables × 10€`.
Affiché en temps réel à l'admin de l'orga. Pas encore connecté à Stripe.

### Plan Enterprise (sur devis)

Pour les grandes structures (>50 sièges) ou besoins spécifiques :
- SLA garanti 99.9%
- Support dédié + onboarding
- SSO / SAML
- Intégrations sur mesure
- Hébergement dédié ou on-premise

Contact via `contact@getbuildr.fr`.

### Phase actuelle : design partners

Pas de facturation active. Les premiers partenaires bénéficient de :
- **6 mois gratuits**
- Onboarding personnalisé
- Réponse aux bugs sous 24h
- Accès aux features beta

En échange :
- Utilisation effective (3+ chantiers actifs)
- Call de feedback toutes les 2 semaines
- Autorisation d'être cité comme référence

Limite : maximum **2-3 partenaires en parallèle** pour rester réactif.

### Migration plan → quand passer payant

| Étape | Trigger |
|---|---|
| Partenaire #1 | Validation produit, feedback initial |
| Partenaires #2-3 | Validation différents profils BTP (PME, artisan, major) |
| Activation Stripe | Quand 3+ orgas demandent à payer / quand les 6 mois s'écoulent |
| Ouverture publique | Quand on a 3+ témoignages et que le produit est stable 1 mois sans bug critique |

---

## 3. Stratégie de distribution mobile

### Choix : **production stores + signup gated**

L'app est publiée normalement sur **App Store** + **Google Play**. N'importe qui peut la télécharger.
Mais **la création de compte est désactivée par défaut** — il faut un lien d'invitation pour s'inscrire.

Flag côté API :
```bash
PUBLIC_SIGNUP_ENABLED=false
```

Quand on est prêt à ouvrir au public → flip à `true`, aucune nouvelle release nécessaire.

### Onboarding partenaire (gated)

1. Super admin (Julien) crée une orga via `/admin/orgs/create` dans le dashboard
2. Super admin envoie un email d'invitation au CEO du partenaire avec rôle `admin`
3. CEO télécharge l'app sur l'App Store / Play Store
4. CEO clique le lien d'invitation dans son email → s'inscrit avec `invitation_token`
5. Depuis le dashboard ou l'app, le CEO invite ses employés via `/team`
6. Chaque employé reçoit son propre lien d'invitation → s'installe l'app, se logue

### Cas spécifique des clients du partenaire

Les clients finaux (particuliers ou maîtres d'ouvrage) **n'installent pas l'app**.

Ils accèdent à leur chantier via un **magic link** (`app.getbuildr.fr/c/xxx`) qui leur ouvre directement la vue web simplifiée de leur chantier sans login. Le lien :
- Est généré par l'admin/manager/créateur via la fiche chantier
- A une durée de vie sliding (30 jours sans activité → expire)
- Peut être révoqué à tout moment
- Ne crée **pas** de compte utilisateur (donc pas facturé)

Implémentation : table `chantier_share_link` (à créer).

### Comptes super admin

Les super_admins (`is_super_admin = true` sur la table `user`) :
- Flag mis à la main en SQL : `UPDATE "user" SET is_super_admin=true WHERE email='...'`
- Accès au panel `/admin/*` dans le dashboard
- Peuvent : créer/désactiver des orgas, désactiver des users, force reset password, kick sessions, impersonate admin d'une orga, voir audit log + error log

---

## 4. Permissions (rappel)

Référence complète : [`buildr-dashboard/docs/PERMISSIONS.md`](../../buildr-dashboard/docs/PERMISSIONS.md)

### Rôles organisation (5)

| Rôle | Description | Facturable |
|---|---|---|
| `admin` | Dirigeant, contrôle total de l'orga | ✅ |
| `manager` | Chef de chantier, peut gérer équipes | ✅ |
| `employee` | Ouvrier terrain | ✅ |
| `client` | Maître d'ouvrage externe, voit ses chantiers | ❌ |
| `gestionnaire_reseau` | Externe (Enedis, GRDF), accès DICT uniquement | ❌ |

### Rôles chantier (4)

`manager`, `ouvrier`, `client`, `gestionnaire_reseau` (pas d'admin chantier — il est implicite via l'orga).

Mapping auto org → chantier : `admin/manager` → manager, `employee` → ouvrier, `client` → client, `gestionnaire_reseau` → gestionnaire_reseau.

### Permissions fines par membre chantier

6 booléens : `can_view_comments`, `can_view_photos`, `can_view_documents`, `can_view_steps`, `can_view_team`, `can_edit`.

Défauts pré-remplis selon le rôle à l'ajout (cf. PERMISSIONS.md).

---

## 5. Coûts

### Coûts fixes / one-shot

| Poste | Coût | Récurrence |
|---|---|---|
| Apple Developer Program | 99€ | par an |
| Google Play Console | 25€ | une seule fois (à vie) |
| Domaine `getbuildr.fr` | 12€ | par an |
| Identité visuelle / icônes | 0-3000€ | one-shot (DIY ou freelance) |
| Mentions légales / privacy / CGU | 0-1500€ | one-shot (DIY ou avocat) |

### Coûts mensuels — phase test (1 partenaire)

| Service | Coût mensuel | Détail |
|---|---|---|
| VPS Hetzner CX22 (4Go RAM) | 4,50€ | Auto-héberge API + Postgres + dashboard + vitrine |
| Stockage photos local | 0€ | Volume Docker (40Go inclus VPS) |
| SSL | 0€ | Let's Encrypt via Caddy |
| Email transactionnel | 0€ | Resend (3000 emails/mois free) |
| Apple Dev (lissé) | 8€ | 99€/an |
| Mobile distribution | 0€ | EAS Build free tier (30 builds/mois) |
| **Total démarrage** | **~13€/mois** | |

### Coûts mensuels — phase scale (10-50 orgas)

| Service | Coût mensuel | Détail |
|---|---|---|
| VPS Hetzner CX42 (16Go RAM) | 30€ | Plus de RAM pour Postgres |
| Storage S3 Backblaze B2 | 5€ | ~500GB photos chantier |
| Backup DB offsite | 3€ | pg_dump cron → B2 |
| Email transactionnel | 0-20€ | Resend / Mailgun selon volume |
| Apple Dev (lissé) | 8€ | |
| Monitoring uptime | 0€ | UptimeRobot ou BetterStack free |
| **Total scale** | **~50-70€/mois** | |

### Coûts mensuels — phase mature (100+ orgas)

| Service | Coût mensuel | Détail |
|---|---|---|
| API hébergée (Fly.io / Railway) | 30-60€ | Auto-scaling |
| Postgres managed (Neon / Supabase) | 20-40€ | Backups auto, scaling |
| Storage S3 | 15-30€ | 1-2TB photos |
| Dashboard + vitrine sur Vercel Pro | 20€ | |
| Email transactionnel | 20-50€ | Mailgun ~50k emails |
| Apple Dev | 8€ | |
| Monitoring / observability | 0-30€ | Grafana Cloud free → BetterStack pro |
| **Total mature** | **~150-250€/mois** | |

### Quand devient rentable

Au tarif 10€ HT/siège/mois :
- **3 sièges** = rentable phase démarrage (30€ > 13€/mois)
- **10 sièges** = 100€/mois - 13€ = 87€/mois marge brute
- **100 sièges** = 1000€/mois - 70€ = 930€/mois marge brute
- **500 sièges** = 5000€/mois - 250€ = 4750€/mois marge brute

---

## 6. Documents obligatoires

### Avant le déploiement public

| Doc | Obligatoire ? | Effort | Outil |
|---|---|---|---|
| **Mentions légales** (`getbuildr.fr/legal`) | Oui (loi LCEN française) | 10 lignes, 30 min | Template + adapter |
| **Politique de confidentialité** (`getbuildr.fr/privacy`) | Oui (RGPD + obligatoire stores Apple/Google) | 1 page, 2-3h | Termly ou iubenda gratuits |
| **Mention "Beta"** dans l'app + footer dashboard | Recommandé | 1 ligne | Footer + bannière |
| **Description app stores** | Oui | 2 paragraphes | Manual |
| **Screenshots stores** (5-8 par store) | Oui | 1 demi-journée | Captures depuis l'app sur devices |
| **Icône 1024×1024** | Oui | 1h | Figma / Canva |
| **Compte démo pour reviewer Apple** | Oui | 30 min | Créer une orga "Buildr Demo" avec data factice |

### À mettre en place avant le 1er euro encaissé

| Doc | Obligatoire ? | Effort |
|---|---|---|
| **CGU / CGV** | Oui | 1 journée avec template (3-5 pages) |
| **Mandat SEPA / acceptation paiement** | Oui si prélèvement | Fourni par Stripe |
| **Facture conforme** (TVA, mentions légales) | Oui | Stripe gère 90% |

### À envisager quand l'activité grossit

| Doc | Trigger | Effort |
|---|---|---|
| **DPA (Data Processing Agreement)** | Premier client qui le demande | 1 journée avec template |
| **Registre des traitements RGPD** | Si > 250 employés OU traitement à risque | À évaluer |
| **DPIA (Analyse d'impact)** | Si traitement de données sensibles | Pas applicable au BTP |
| **DPO désigné** | Idem | Pas applicable |
| **Assurance RC pro** | Recommandé dès les 1ers clients payants | 300-800€/an |

### Filet de sécurité pour les partenaires (phase beta)

À inclure dans le **Design Partner Agreement** (1 page email/PDF) :

> Le logiciel Buildr est en phase de développement beta. Il est fourni "tel quel", sans garantie
> de disponibilité ni de bon fonctionnement. Le Partenaire accepte que des bugs ou pertes de
> données peuvent survenir, et s'engage à ne pas y stocker de données critiques sans
> sauvegarde externe. La durée de l'engagement est de 6 mois, résiliable à tout moment
> par chacune des parties sans frais ni pénalité.

---

## 7. Plan de mise en production

### Semaine 1 — Backend en prod

| Jour | Action |
|---|---|
| J1 | Commander VPS Hetzner CX22 + domaine `getbuildr.fr` |
| J1 | Pointer DNS : `getbuildr.fr`, `app.getbuildr.fr`, `api.getbuildr.fr` vers IP VPS |
| J2 | Setup serveur : Docker, docker-compose, Caddy en reverse proxy |
| J2 | `docker-compose.prod.yml` avec 4 services + volume DB + uploads |
| J3 | Régénérer `JWT_SECRET` et `API_KEY` en prod |
| J3 | Cron `pg_dump` quotidien vers Backblaze B2 |
| J4 | Tests end-to-end : signup partenaire fictif, upload photo, magic link client |
| J5 | Setup monitoring uptime (UptimeRobot) |

### Semaine 2 — Préparation mobile

| Jour | Action |
|---|---|
| J6 | Compte Apple Developer (99€) — validation prend ~24-48h |
| J6 | Compte Google Play (25€) — validation rapide |
| J6 | Pages `getbuildr.fr/legal` + `getbuildr.fr/privacy` |
| J7 | Configurer `app.json` : bundle IDs, permissions, version |
| J7 | Designer / récupérer icône 1024×1024 + adaptive icon Android |
| J8 | Préparer 5-8 screenshots par store (iPhone + Android) |
| J9 | Implémenter le flag `PUBLIC_SIGNUP_ENABLED` dans `auth.service.ts` |
| J9 | Cacher le bouton "Créer un compte" dans le mobile + dashboard si pas d'invitation |
| J10 | Créer page `/admin/orgs/create` dans le dashboard |

### Semaine 3 — Build & submission

| Jour | Action |
|---|---|
| J11 | `eas build --platform ios --profile production` (~20 min) |
| J11 | `eas build --platform android --profile production` (~15 min) |
| J12 | Créer fiche App Store Connect avec description, screenshots, compte démo |
| J12 | `eas submit --platform ios --latest` → soumission TestFlight d'abord |
| J13 | Créer fiche Google Play Console avec description, screenshots |
| J13 | `eas submit --platform android --latest` → Internal Testing |
| J14 | Sumbit pour review production Apple (peut prendre 1-2 semaines la 1ère fois) |

### Semaine 4-5 — Validation Apple + Onboarding partenaire

| Action |
|---|
| Attente review Apple (asynchrone) |
| En parallèle : préparer l'onboarding du 1er partenaire |
| Quand validé : l'app est dans l'App Store + Play Store, accessible mais signup gated |
| Créer orga "Partenaire Pilote" via `/admin/orgs/create` |
| Envoyer invitation admin au CEO du partenaire |
| Call de onboarding avec le partenaire (1-2h sur place idéalement) |
| Partenaire invite ses équipes, ils installent l'app via les stores |

### Checklist pré-launch finale

- [ ] DNS configuré et pointant sur le VPS
- [ ] SSL valide sur les 3 sous-domaines
- [ ] `JWT_SECRET` et `API_KEY` régénérés (pas les valeurs default)
- [ ] Postgres non exposé sur Internet (network Docker interne)
- [ ] Backup DB testé (restore vérifié)
- [ ] Pages `/legal` et `/privacy` en ligne
- [ ] Footer "Beta" visible sur dashboard + vitrine
- [ ] Compte super_admin créé et flaggé `is_super_admin = true`
- [ ] `PUBLIC_SIGNUP_ENABLED=false` dans la config prod
- [ ] App approuvée par Apple + Google
- [ ] Compte démo Apple créé avec data factice
- [ ] Design Partner Agreement prêt (template Markdown)
- [ ] Magic link client implémenté (à coder)
- [ ] `/admin/orgs/create` opérationnel (à coder)

---

## 8. Roadmap super admin

Référence : sprints super admin déjà discutés.

### Sprint 1 — Foundation (déjà fait ✅)

- ✅ Flag `is_super_admin` sur user
- ✅ Flag `is_active` sur organization (kill switch)
- ✅ Middleware `requireSuperAdmin`
- ✅ Table `audit_log` (qui, quoi, quand)
- ✅ Table `error_log` (Sentry maison)
- ✅ Pages `/admin/overview`, `/admin/orgs`, `/admin/users`, `/admin/audit`, `/admin/errors`
- ✅ Actions : impersonate, kill switch, désactiver/réactiver user, force reset password, kick sessions, delete user

### Sprint 2 — Pré-launch (à faire)

- [ ] Page `/admin/orgs/create` — créer une orga + envoyer invitation admin en 1 clic
- [ ] Flag `PUBLIC_SIGNUP_ENABLED` côté API
- [ ] UI signup invitation-only dans mobile + dashboard
- [ ] Magic link client (table `chantier_share_link` + module API + page `/c/[token]`)
- [ ] Stats engagement par orga dans `/admin/orgs/[id]` (DAU/MAU, chantiers/mois, photos/mois)
- [ ] Pages légales (`/legal`, `/privacy`) sur la vitrine

### Sprint 3 — Support tickets (post-launch)

- [ ] Table `support_ticket` + module API
- [ ] Bouton "Signaler un problème" dans le profil mobile
- [ ] Inbox `/admin/support` avec filtres status / partenaires
- [ ] Système de réponse depuis le dashboard → email + push au user
- [ ] Priorité haute auto pour les partenaires (`billing_status = 'partner'`)

### Sprint 4 — Quand Stripe arrive

- [ ] Intégration Stripe Customer Portal
- [ ] Webhooks Stripe → mettre à jour `organization.billing_status`
- [ ] Page `/billing` (org admin) avec Stripe Customer Portal embedded
- [ ] Page `/admin/billing` (super admin) : abonnements actifs, refunds, crédits

### Sprint 5 — Communication plateforme

- [ ] Table `platform_banner` (annonces in-app)
- [ ] Page `/admin/announcements` pour créer / éditer / désactiver
- [ ] Bannière affichée en haut de l'app mobile + dashboard
- [ ] Broadcast push aux admins toutes orgas

---

## 9. Risques identifiés et mitigations

| Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|
| Apple review rejette l'app | Faible | Bloque le launch | Compte démo + description claire B2B SaaS ; 1-2 itérations max |
| Perte de données (bug ou disque) | Moyenne | Critique pour partenaire | Backup DB quotidien + photos sur B2 + clause "sans garantie" dans Design Partner Agreement |
| Compromission super_admin | Faible | Catastrophique | 2FA obligatoire (à coder dès 1er super_admin externe) + audit_log + isolation des ops sensibles |
| Partenaire abandonne après 1 mois | Moyenne | Validation invalide | Onboarding personnalisé + suivi bi-mensuel + monitoring engagement |
| Demande de suppression RGPD | Possible | Faible si bien préparé | Endpoint super_admin "Supprimer définitivement user" déjà en place |
| Saturation VPS | Faible au début | Downtime | Monitoring + plan de migration VPS plus gros (CX42 → CX52) |
| Concurrent direct | Moyenne | Marché | Premier témoignage partenaire = différenciateur |

---

## 10. Contacts & ressources

### Internes

- **Super admin Buildr** : Julien Schubnel — `julien@getbuildr.fr`
- **Compte technique** : `tech@getbuildr.fr` (à créer pour notifications stores)
- **Compte support** : `contact@getbuildr.fr` ou `support@getbuildr.fr`

### Externes

| Service | URL | Usage |
|---|---|---|
| Apple Developer | https://developer.apple.com | Gestion compte iOS |
| App Store Connect | https://appstoreconnect.apple.com | Submission iOS |
| Google Play Console | https://play.google.com/console | Submission Android |
| Expo / EAS | https://expo.dev | Build mobile |
| Hetzner Cloud | https://console.hetzner.cloud | VPS |
| Backblaze B2 | https://www.backblaze.com/b2/ | Storage + backups |
| Resend | https://resend.com | Email transactionnel |
| Termly / iubenda | https://termly.io / https://www.iubenda.com | Templates privacy policy |

---

## Annexes

### A. Variables d'environnement de prod requises

```bash
# API (.env)
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

DB_HOST=buildr-db
DB_PORT=5432
DB_NAME=buildr
DB_USER=buildr
DB_PASSWORD=<long-random-secret>

JWT_SECRET=<long-random-secret-min-64-chars>
JWT_ACCESS_EXPIRES=15m
API_KEY=<long-random-secret>

PUBLIC_SIGNUP_ENABLED=false

SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASSWORD=<resend-api-key>
SMTP_FROM=Buildr <noreply@getbuildr.fr>
APP_URL=https://app.getbuildr.fr

STORAGE_MODE=local           # ou 's3' quand on switch
# S3 vars si STORAGE_MODE=s3
```

### B. Caddyfile minimal (à mettre sur le VPS)

```
getbuildr.fr {
    reverse_proxy buildr-website:3000
}

app.getbuildr.fr {
    reverse_proxy buildr-dashboard:3000
}

api.getbuildr.fr {
    reverse_proxy buildr-api:3000
}
```

### C. Commande de déploiement

Sur le VPS, après git clone :
```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec buildr-api npm run migrate
```

Mises à jour suivantes :
```bash
git pull && docker compose -f docker-compose.prod.yml up -d --build
```
