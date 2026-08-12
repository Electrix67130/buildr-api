# Buildr — Contenu des fiches store

Textes et déclarations à recopier dans Google Play Console et App Store Connect.

**Dernière mise à jour :** 13 août 2026

---

## 1. Identité

| Champ | Valeur |
|---|---|
| Nom de l'app | Buildr |
| Nom du développeur (Google, libre) | Buildr |
| Nom du vendeur (Apple, imposé) | PG TERRASSEMENT |
| Package / Bundle ID | `fr.getbuildr.app` |
| Catégorie | Entreprise (Google) / Business (Apple) |
| Prix | Gratuit |
| Politique de confidentialité | `https://getbuildr.fr/privacy` |
| Support | `https://getbuildr.fr/support` |
| Site marketing | `https://getbuildr.fr` |

---

## 2. Description courte (Google, 80 caractères max)

```
Suivez vos chantiers, vos équipes et vos photos de terrain depuis le chantier.
```

---

## 3. Description longue

```
Buildr est l'application de gestion de chantiers pensée pour le terrain.

Fini les photos perdues dans les téléphones, les comptes rendus notés sur un
coin de table et les appels pour savoir où en est le chantier. Buildr rassemble
au même endroit tout ce qui concerne un chantier, accessible depuis le bureau
comme depuis la benne du camion.

CE QUE VOUS POUVEZ FAIRE

• Suivre vos chantiers en cours et consulter leur avancement en temps réel
• Prendre des photos de chantier et les classer automatiquement au bon endroit
• Découper un chantier en étapes et sous-étapes, et cocher ce qui est terminé
• Réutiliser vos modèles de chantier pour ne pas repartir de zéro à chaque fois
• Échanger avec votre équipe dans une discussion rattachée au chantier
• Stocker les documents utiles : devis, plans, DICT, PV de réception
• Signaler une urgence avec photo et localisation, et alerter les bonnes
  personnes immédiatement
• Gérer les accès : chaque intervenant ne voit que ce qui le concerne
• Retrouver vos chantiers terminés dans les archives

POUR QUI

Buildr s'adresse aux entreprises du bâtiment et des travaux publics : gros
œuvre, terrassement, VRD, second œuvre, réseaux. Il convient aussi à tout
métier qui coordonne des équipes et des tiers autour d'un site : paysage,
installation industrielle, maintenance technique, événementiel.

CHACUN À SA PLACE

Le dirigeant pilote l'ensemble de ses chantiers. Le chef de chantier gère ses
équipes et ses étapes. L'ouvrier voit ses chantiers du jour et remonte ses
photos. Le client suit l'avancement de son projet sans voir le reste. Les
gestionnaires de réseau accèdent uniquement aux informations qui les concernent.

VOS DONNÉES RESTENT EN FRANCE

Les données sont hébergées chez Scaleway, à Paris, et ne transitent par aucun
prestataire hors Union européenne. Vous pouvez supprimer votre compte
directement depuis l'application.

ACCÈS

L'inscription se fait sur invitation. Créez votre espace sur getbuildr.fr, ou
demandez une invitation à l'administrateur de votre entreprise.

Buildr est en version bêta : l'accès est gratuit pour tous jusqu'à la fin de la
période de bêta.
```

---

## 4. Google Play — formulaire « Sécurité des données »

Réponses vérifiées contre le schéma de la base et le code de l'app mobile.
Une déclaration inexacte est un motif de suspension : ne pas modifier sans
revérifier le code.

### Réponses globales

| Question | Réponse | Justification |
|---|---|---|
| Les données sont-elles chiffrées en transit ? | **Oui** | HTTPS sur tous les domaines, TLS Let's Encrypt via Caddy |
| L'utilisateur peut-il demander la suppression de ses données ? | **Oui** | `DELETE /users/me` depuis l'écran Profil, avec confirmation par mot de passe |
| Partagez-vous des données avec des tiers ? | **Non** | aucun SDK analytics, publicitaire ou de crash reporting dans l'app |
| Collecte à des fins publicitaires ? | **Non** | |

### Données collectées

| Catégorie Google | Type | Collectée | Obligatoire | Finalité | Où dans le code |
|---|---|---|---|---|---|
| Informations personnelles | Nom | Oui | Oui | Fonctionnalité de l'app, gestion du compte | `user.first_name`, `user.last_name` |
| Informations personnelles | Adresse e-mail | Oui | Oui | Fonctionnalité, gestion du compte, identification | `user.email` |
| Informations personnelles | Numéro de téléphone | Oui | Non | Fonctionnalité (contacter un intervenant) | `user.phone`, nullable |
| Informations personnelles | Autres informations | Oui | Non | Fonctionnalité | `user.company_name` |
| Photos et vidéos | Photos | Oui | Non | Fonctionnalité (photos de chantier, avatar) | `photo`, `emergency.photo_url`, avatar |
| Fichiers et documents | Fichiers et documents | Oui | Non | Fonctionnalité (devis, plans, DICT) | module `document` |
| Position | Position exacte | Oui | Non | Fonctionnalité (géolocalisation d'une urgence) | `EmergencyList.tsx` → `emergency.latitude/longitude` |
| Messages | Autres messages in-app | Oui | Non | Fonctionnalité (discussions de chantier) | modules `comment`, `photo-comment`, `emergency-comment` |
| ID de l'appareil ou autres | ID de l'appareil | Oui | Non | Fonctionnalité (notifications push) | module `push-token` |

**Non collectées** : données de localisation en arrière-plan, contacts, agenda,
SMS, historique de navigation, santé, informations financières, données
d'installation d'autres apps, activité dans l'app à des fins d'analyse.

### Note sur la position

L'app demande la position **uniquement** au moment où l'utilisateur prend une
photo d'urgence, en premier plan, avec `Accuracy.High` (~10 m). Aucun suivi en
arrière-plan, aucune position enregistrée en dehors de ce geste.

La précision de 10 m est un choix produit assumé : sur un chantier, il faut
pouvoir retrouver le point exact du danger, pas seulement la parcelle. Elle
impose `ACCESS_FINE_LOCATION` et donc la déclaration « **Position exacte** ».

La justification à donner si Google la demande : signalement d'incident de
sécurité sur chantier, géolocalisation ponctuelle déclenchée par l'utilisateur,
sans collecte continue.

---

## 5. Google Play — autres déclarations

| Rubrique | Réponse |
|---|---|
| Accès à l'application | Connexion requise → fournir les identifiants du compte de démonstration |
| Annonces | L'app ne contient aucune publicité |
| Classification du contenu | Questionnaire : app utilitaire / productivité, aucun contenu sensible |
| Public cible | 18 ans et plus — outil professionnel |
| App destinée aux enfants | Non |
| Application gouvernementale | Non |
| Fonctionnalités financières | Aucune |
| App de santé | Non |

---

## 6. Apple — App Privacy (nutrition labels)

Correspondances des mêmes données dans le vocabulaire d'Apple. Toutes sont
**liées à l'utilisateur** (Data Linked to You) et **aucune n'est utilisée pour
le suivi** (Tracking : non).

| Catégorie Apple | Type | Finalité |
|---|---|---|
| Contact Info | Name, Email Address, Phone Number | App Functionality |
| User Content | Photos or Videos, Other User Content | App Functionality |
| Location | Precise Location | App Functionality |
| Identifiers | Device ID | App Functionality |

**Tracking** : non. **Data Used to Track You** : aucune. **Data Not Linked to
You** : aucune.

---

## 7. Assets à produire

| Asset | Format | Pour |
|---|---|---|
| Icône | 512×512 PNG | Google |
| Feature graphic | 1024×500 | Google |
| Captures téléphone | 2 minimum, viser 5 à 8 | Google |
| Captures iPhone 6,9" | 5 à 8 | Apple |
| Captures iPad | — | plus nécessaire (`supportsTablet: false`) |

Écrans à capturer, dans cet ordre : liste des chantiers, fiche chantier avec ses
étapes, galerie photos, discussion d'équipe, signalement d'urgence.

---

## 8. Compte de démonstration pour la review

À créer avant la soumission, dans une organisation dédiée « Buildr Demo »
contenant des données factices — jamais de données d'un partenaire réel.

- Identifiants à transmettre dans les notes de review Apple et dans la rubrique
  « Accès à l'application » de Google Play.
- Prévoir 2 ou 3 chantiers avec photos, étapes, documents et discussions, pour
  que le reviewer voie une app remplie et non des écrans vides.
