# Tests

461 tests repartis en deux etages : des tests unitaires sur les fonctions pures
et des tests d'integration qui jouent de vraies requetes HTTP contre
l'application complete, branchee sur un vrai PostgreSQL.

## Lancer les tests

```bash
npm run test:db:up      # demarre la base de test (docker, port 5433)
npm test                # tout
npm run test:unit       # unitaires seuls — aucune base necessaire
npm run test:integration
npm run test:watch      # relance a chaque modification
npm run test:db:down    # arrete et supprime la base
```

La base de test n'a pas de volume : elle vit en memoire et disparait avec le
conteneur. Les migrations sont appliquees automatiquement au lancement de
l'etage integration.

## Ce qui est couvert

**Unitaires** (`tests/unit/`) — aucune base, quelques centaines de millisecondes.

| Fichier | Objet |
|---|---|
| `sign-url.test.ts` | Signature des URLs de fichiers : validite, peremption, non-transferabilite d'un jeton d'un fichier a l'autre |
| `mail-i18n.test.ts` | Les huit langues des e-mails : aucune cle manquante, aucun bloc recopie du francais, aucune apostrophe perdue |
| `mail-content.test.ts` | Contenu des e-mails : liens, langue, format des dates, echappement |
| `schemas.test.ts` | Validation Zod des entrees : ce qui entre en base et ce qui est rejete |
| `push-content.test.ts` | Textes des notifications dans les huit langues, et composition de chaque message |
| `image.test.ts` | Traitement des photos : retrait des metadonnees EXIF, orientation, redimensionnement, miniatures |
| `crypto.test.ts` | Chiffrement des jetons OAuth : aller-retour, detection d'alteration, jetons aleatoires |
| `mail-transport.test.ts` | Acheminement des e-mails : choix du transport, version texte, expediteur |
| `session-cache.test.ts` | Cache des sessions : peremption, separation des plateformes, invalidation |
| `email.test.ts` | Normalisation des adresses e-mail : minuscules, espaces, validation |

**Integration** (`tests/integration/`) — application complete + base.

| Fichier | Objet |
|---|---|
| `org-scoping.test.ts` | Cloisonnement entre organisations : rien d'une organisation ne doit etre lisible ni modifiable depuis une autre |
| `permissions.test.ts` | Droits par role (admin, manager, employe, client) |
| `invitation.test.ts` | Parcours d'invitation : envoi, consultation du lien, inscription, langue, expiration, annulation |
| `auth.test.ts` | Inscription, connexion, sessions par plateforme, renouvellement, mot de passe oublie, organisation active |
| `chantier-visibility.test.ts` | Qui voit quel chantier au sein d'une organisation, archivage, filtres |
| `files.test.ts` | Acces aux fichiers : la seule route sans cle d'API, protegee par le seul jeton signe |
| `feedback.test.ts` | Signalements : depot, cloisonnement auteur/support, reponse, notification a l'auteur |
| `push.test.ts` | Envoi des notifications : une langue par destinataire, exclusion de l'acteur, refus des notifications |
| `chantier-permissions.test.ts` | Droits fins au sein d'un chantier : un drapeau ouvre une ressource et une seule |
| `team.test.ts` | Equipes : composition, consultation, cloisonnement entre organisations |
| `super-admin.test.ts` | Console Buildr : garde sur chaque route, usurpation d'identite, coupure de compte, journal d'audit |
| `chantier-step.test.ts` | Etapes et sous-etapes : composition, validation, ordre, cloisonnement |
| `emergency.test.ts` | Urgences, fil de discussion, et gestion des membres d'un chantier |

Ces axes ont ete choisis parce qu'ils partagent une propriete : leurs defauts ne
se voient pas a l'usage normal. Il faut connaitre l'identifiant d'une ressource
d'autrui, forger une requete ou parler une des huit langues pour les
declencher — donc personne ne les signale, et ils survivent aux campagnes de
tests manuels.

## Garde-fou

`tests/global-setup.ts` refuse de demarrer si la base visee ne s'appelle pas
`*_test`, si le port n'est pas 5433 ou si l'hote n'est pas local. Les tests
vident toutes les tables entre chaque cas : se tromper de base couterait la base
de developpement.

Le `.env` du poste ne peut pas prendre le dessus : `vitest.config.ts` pose les
variables avant tout chargement, et dotenv n'ecrase jamais une variable deja
definie. SMTP et Resend y sont explicitement vides, donc aucun test ne peut
envoyer un e-mail reel.

## Conventions

- Un fichier par propriete verifiee, pas un fichier par module.
- Les intitules decrivent la regle metier, pas la route : « un manager ne peut
  pas nommer d'admin » plutot que « POST /invitations 403 ».
- Un test qui rejoue un defaut passe explique en commentaire ce qui avait casse.
- Les comptes sont crees en base par les fabriques (`tests/helpers/factories.ts`)
  mais l'authentification passe par `POST /auth/login` : c'est un vrai jeton qui
  est teste. Le condensat de mot de passe y est calcule a un cout bcrypt de 4 au
  lieu de 12 — c'est ce qui fait tenir la suite en vingt secondes.
- La cle d'API est ajoutee d'office par le harnais, comme le font les clients
  reels ; `files.test.ts` couvre son absence la ou elle est legitime.
- Aucun test ne sort sur le reseau. L'envoi de notifications push est observe en
  interceptant `fetch` (`push.test.ts`, `feedback.test.ts`) : c'est le seul moyen
  de verifier un envoi declenche en arriere-plan sans appeler vraiment l'API
  d'Expo.
- Les notifications partent en arriere-plan, detachees de la reponse HTTP. Une
  notification declenchee par la preparation d'un test peut donc atterrir pendant
  le test lui-meme : `push.test.ts` filtre les messages sur leur type plutot que
  de compter les envois. Attendre « au moins un envoi » rendait le test
  dependant de l'ordre d'arrivee, et donc instable.
