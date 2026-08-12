# Buildr — Plan de soumission App Store et Google Play

Plan opérationnel pour publier l'app mobile Buildr (`buildr-ui`, Expo + EAS).

**Dernière mise à jour :** 12 août 2026
**Éditeur :** PG TERRASSEMENT (SARL, RCS Épinal 902 611 094) — société mère.
Une structure dédiée à l'app est prévue plus tard, l'app sera alors transférée
(cf. § 6).

---

## 0. État des lieux

### Déjà fait

| | |
|---|---|
| API en production | `api.getbuildr.fr`, à jour, HTTPS |
| Vitrine + dashboard | `getbuildr.fr`, `app.getbuildr.fr`, HTTPS |
| Pages légales publiques | `/privacy`, `/cgu`, `/mentions-legales` — PG TERRASSEMENT éditeur |
| Bundle identifiers | `fr.getbuildr.app` (iOS et Android) |
| Icônes | `icon.png`, `adaptive-icon.png`, splash — 1024×1024 |
| Permissions | déclarées avec descriptions FR (caméra, photos, localisation) |
| Suppression de compte in-app | requise par la guideline Apple 5.1.1(v) |
| Projet EAS + `eas.json` | profils development / simulator / preview / production |
| Chiffrement | `ITSAppUsesNonExemptEncryption: false` — évite le questionnaire export |

### Prérequis non satisfaits

| Bloque | Quoi |
|---|---|
| les deux stores | boîtes `support@getbuildr.fr` et `privacy@getbuildr.fr` inexistantes |
| les deux stores | comptes développeur non créés |
| le build | variables d'environnement EAS non créées |
| le push Android | credentials FCM V1 non fournis à EAS |
| la fiche iOS | captures d'écran iPhone (et iPad, cf. § 3.1) |
| la fiche Android | captures, feature graphic 1024×500, icône 512×512 |
| la review | compte de démonstration avec données factices |

---

## 1. Chemin critique

La validation des comptes est le seul délai qu'on ne maîtrise pas. Tout le reste
peut avancer en parallèle.

```
J0   Créer les comptes Apple + Google ─────────┐
     Créer les boîtes email                    │ 24-48 h (Apple)
J0   Variables EAS + credentials push          │ jusqu'à 30 j si D-U-N-S absent
J1   Build preview + test sur device réel      │
J2   Captures + textes des fiches              │
J3   Compte de démonstration                   │
J3   ◄──────────────────────────────────────────┘ comptes validés
J3   Build production + upload
J4   Soumission TestFlight / Internal Testing
J5   Soumission review publique  ──► Apple : 24 h à 2 semaines la 1re fois
```

---

## 2. Comptes développeur

### 2.1 Apple Developer Program — 99 $/an

Enrollment **Organization** (le nom du vendeur affiché sur l'App Store sera
« PG TERRASSEMENT » ; l'app, elle, s'appelle « Buildr »).

- [ ] Créer un Apple Account dédié sur le domaine de la société :
      `dev@pgterrassement.fr` — Apple exige que l'email soit sur le domaine de
      l'organisation. Activer la **double authentification** (obligatoire).
- [ ] Vérifier le D-U-N-S sur `developer.apple.com/enroll/duns-lookup` :
      `276898250`. Contrôler que la raison sociale et l'adresse renvoyées par
      Dun & Bradstreet sont à jour — Apple compare **au caractère près**, et une
      correction chez D&B prend plusieurs semaines.
- [ ] Enrollment sur `developer.apple.com/programs/enroll` :
      - Entité : PG TERRASSEMENT, SARL
      - Adresse : 34 B rue d'Alsace, 88000 Deyvillers (pas de boîte postale)
      - Site web : **`https://www.pgterrassement.fr`** (celui de la société, pas
        `getbuildr.fr` dont le whois affiche une personne physique)
      - Titulaire : personne ayant autorité pour engager la société. Si ce n'est
        pas toi, autorisation écrite d'un dirigeant.
- [ ] Accepter les contrats Paid & Free Applications dans App Store Connect
      (sans quoi ni soumission ni transfert ultérieur ne sont possibles).

### 2.2 Google Play Console — 25 € une seule fois

- [ ] Créer un compte Google dédié à la société.
- [ ] Compte **organisation** sur `play.google.com/console/signup` : D-U-N-S
      `276898250`, raison sociale, adresse, téléphone, site web.
- [ ] **Developer name public : « Buildr »** — contrairement à Apple, Google
      autorise un nom libre et modifiable.
- [ ] Vérification développeur : Kbis, justificatif d'adresse physique, pièce
      d'identité du représentant autorisé (qui doit figurer sur l'immatriculation).
      **Obligatoire à partir de septembre 2026** — à ne pas repousser.

### 2.3 Emails

- [ ] `support@getbuildr.fr` et `privacy@getbuildr.fr` — cités dans les pages
      légales et demandés par les deux stores. Un alias chez Scaleway ou OVH
      suffit.

---

## 3. Fiches store

### 3.1 Décision préalable : iPad

`app.json` déclare `"supportsTablet": true`. Conséquence : App Store Connect
réclame un jeu de **captures iPad** en plus des captures iPhone, et le reviewer
teste l'app sur iPad — une mise en page cassée en grand format est un motif de
rejet.

Deux options :
- **Recommandé si l'app n'a jamais été testée sur iPad** : passer
  `supportsTablet` à `false`. Moins de captures, moins de surface de rejet.
  Réactivable dans une version ultérieure.
- Sinon : tester sur simulateur iPad et produire les captures.

### 3.2 Assets communs

- [ ] 5 à 8 captures par plateforme, prises sur device ou simulateur
- [ ] Description courte (Google : 80 caractères max)
- [ ] Description longue (Google : 4 000 caractères ; Apple : 4 000)
- [ ] Mots-clés (Apple : 100 caractères, séparés par des virgules)
- [ ] URL de politique de confidentialité : `https://getbuildr.fr/privacy`
- [ ] URL de support : `https://getbuildr.fr/support`
- [ ] Catégorie : Entreprise / Productivité

### 3.3 Spécifique Apple

- [ ] Captures **iPhone 6,9"** (obligatoire) — les autres tailles sont dérivées
- [ ] App Privacy (« nutrition labels ») : déclarer les données collectées —
      identité, coordonnées, photos, localisation, contenu utilisateur
- [ ] Compte de démonstration + mot de passe dans les notes de review
      (l'app exige une connexion : sans compte de test, rejet automatique)
- [ ] Note de review expliquant le contexte : SaaS B2B de gestion de chantiers,
      inscription sur invitation

### 3.4 Spécifique Google

- [ ] Icône 512×512 PNG
- [ ] Feature graphic 1024×500
- [ ] Au moins 2 captures téléphone
- [ ] Formulaire **Data safety** (équivalent des nutrition labels)
- [ ] Questionnaire de classification du contenu
- [ ] Public cible et déclaration « app non destinée aux enfants »

---

## 4. Technique avant build

- [ ] `npm i -g eas-cli && eas login`
- [ ] Créer les **variables d'environnement EAS** pour les profils `preview` et
      `production` (sur expo.dev ou `eas env:create`) :
      `EXPO_PUBLIC_API_URL=https://api.getbuildr.fr`,
      `EXPO_PUBLIC_API_KEY`, `EXPO_PUBLIC_DASHBOARD_URL=https://app.getbuildr.fr`.
      Sans elles, le build sort sans URL d'API.
      Rappel : tout `EXPO_PUBLIC_*` est **en clair dans le bundle** — l'API key
      est extractible, elle ne vaut que comme garde-fou anti-scan.
- [ ] Push iOS : laisser EAS générer la clé APNs (automatique une fois le compte
      Apple lié).
- [ ] Push Android : créer un projet Firebase, récupérer la clé de compte de
      service **FCM V1** et l'uploader dans les credentials EAS.
- [ ] Compléter `submit.production` dans `eas.json` : `ascAppId` (iOS) et
      `serviceAccountKeyPath` (Android), ou répondre aux questions
      interactives d'`eas submit`.
- [ ] `eas build -p ios --profile preview` et `-p android --profile preview`,
      puis **test sur device réel** contre la prod : connexion, création de
      chantier, upload photo, notification push, suppression de compte.

---

## 5. Soumission

### iOS
1. `eas build -p ios --profile production`
2. Créer la fiche dans App Store Connect (bundle ID `fr.getbuildr.app`)
3. `eas submit -p ios --latest` → TestFlight
4. Valider soi-même sur TestFlight avant de soumettre à la review publique
5. Soumettre pour review — compter 24 h à 2 semaines pour un premier dépôt

### Android
1. `eas build -p android --profile production`
2. **Premier upload manuel** de l'AAB dans la Play Console : Google n'autorise
   pas l'API à créer la toute première release d'une app
3. Piste **Internal testing**, puis Closed / Open testing si besoin
4. Promotion en Production une fois la vérification développeur terminée

---

## 6. Transfert vers la structure dédiée (plus tard)

Le transfert d'app entre comptes Apple est prévu et conserve le **bundle ID**,
les **notes et avis**. Conditions et pièges :

- l'app doit avoir eu **au moins une version publiée** sur l'App Store ;
- aucun statut en cours (Waiting for Review, In Review, Pending Release…) ;
- les deux comptes en règle, contrats à jour ;
- **supprimer builds et testeurs TestFlight** avant le transfert ;
- les certificats APNs ne suivent pas : à régénérer côté destinataire ;
- pas de merchant ID Apple Pay transféré (non concerné ici) ;
- les données de ventes antérieures restent chez le cédant.

Conséquence pratique : ne pas construire de dépendance à TestFlight à long terme,
et prévoir que le **nom du vendeur changera** sur la fiche App Store le jour du
transfert. Les pages légales devront être mises à jour le même jour (éditeur et
responsable de traitement).

Côté Google Play, le changement de titulaire passe par un transfert de compte ou
une nouvelle fiche — à arbitrer le moment venu.

---

## 7. Traps identifiés

| Piège | Conséquence | Parade |
|---|---|---|
| Raison sociale ≠ fiche D&B | enrollment bloqué des semaines | vérifier le lookup avant de payer |
| Email hors domaine société | enrollment Organization refusé | `dev@pgterrassement.fr` |
| `getbuildr.fr` comme site de l'organisation | whois = personne physique, incohérence | déclarer `pgterrassement.fr` |
| Pas de compte de démo | rejet automatique (app avec login) | créer une orga « Buildr Demo » |
| `supportsTablet: true` non testé | rejet sur mise en page iPad | passer à `false` ou tester |
| Variables EAS oubliées | build sans URL d'API, app inutilisable | `eas env:create` avant le build |
| Premier upload Android via API | échec | premier AAB à la main |
| Vérification Google après sept. 2026 | app non installable | créer et vérifier le compte maintenant |
