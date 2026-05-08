# Buildr API

API REST pour la gestion de chantiers Buildr.

**Stack** : Fastify + Knex (PostgreSQL) + Zod + TypeScript

## Démarrage rapide

### 1. Pré-requis

- Node.js ≥ 20
- PostgreSQL 14+
- Docker / Docker Compose (optionnel mais recommandé pour la BDD)

### 2. Installation

```bash
npm install
cp .env.example .env
# édite .env avec tes credentials BDD, JWT secret, etc.
```

### 3. Base de données

Avec Docker Compose (recommandé) :

```bash
docker compose up -d  # démarre Postgres
```

Puis applique les migrations et seeds :

```bash
npm run migrate
npm run seed   # optionnel — données de démo
```

### 4. Lancer l'API

```bash
npm run dev      # mode dev (watch via tsx)
npm start        # production
```

L'API écoute sur `http://localhost:3000` par défaut.

## Commandes

| Commande | Description |
|---|---|
| `npm run dev` | Dev avec hot-reload (tsx watch) |
| `npm start` | Run en production |
| `npm run build` | Compile TS → dist |
| `npm run migrate` | Applique les migrations Knex |
| `npm run migrate:make -- <name>` | Crée une nouvelle migration |
| `npm run migrate:rollback` | Rollback la dernière migration |
| `npm run seed` | Lance les seeds |
| `npm run seed:make -- <name>` | Crée un nouveau seed |
| `npm test` | Lance les tests (Jest) |

## Architecture

```
src/
├── config/          # env.ts, knexfile
├── lib/             # BaseService, CrudRouteBuilder (générique)
├── migrations/      # Migrations Knex (horodatées)
├── modules/         # Un dossier par entité métier
│   └── <entity>/
│       ├── index.ts             # Routes Fastify
│       ├── <entity>.service.ts  # Logique métier (extends BaseService)
│       └── <entity>.schema.ts   # Schemas Zod + types TS
├── plugins/         # Plugins Fastify (db, jwt, error-handler…)
├── seeds/           # Seeds Knex
├── app.ts           # Configuration Fastify (plugins + autoload modules)
└── server.ts        # Point d'entrée (listen)
```

### Principes

- **Séparation des couches** : Route (HTTP) → Service (métier) → BaseService (DB). Jamais de SQL dans les routes.
- **Validation via Zod** uniquement, dans les fichiers `.schema.ts`.
- **Pas de try/catch dans les routes** : un error-handler global les gère.
- **TypeScript strict**, jamais de `any`.

## Documentation

- **[`docs/API.md`](docs/API.md)** — Référence complète des endpoints (pour le frontend)
- **[`docs/MCD.md`](docs/MCD.md)** — Modèle de données (tables, relations, contraintes)
- **[`.claude/`](.claude/)** — Guides détaillés (TypeScript, naming, CRUD pattern, Fastify, clean code, tests, patterns avancés)

## Structure d'un module

Pour ajouter une nouvelle entité (ex: `widget`) :

1. **Schema** : `src/modules/widget/widget.schema.ts`
2. **Service** : `src/modules/widget/widget.service.ts` — `extends BaseService<WidgetRow>`
3. **Routes** : `src/modules/widget/index.ts` — utilise `CrudRouteBuilder` + routes custom
4. **Migration** : `npm run migrate:make -- create_widget`
5. **Doc** : ajoute la route à `docs/API.md` et la table à `docs/MCD.md`

Voir [`.claude/03-crud-pattern.md`](.claude/03-crud-pattern.md) pour le détail.

## Auth

L'API utilise JWT (access + refresh tokens). Endpoints :

- `POST /auth/register` — Inscription
- `POST /auth/login` — Connexion
- `POST /auth/refresh` — Renouvellement
- `POST /auth/logout`

Les routes protégées requièrent `Authorization: Bearer <access_token>`.

## Variables d'environnement

Voir [`.env.example`](.env.example) pour la liste complète. Les principales :

| Variable | Description |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `JWT_SECRET` | Secret pour signer les access tokens |
| `JWT_REFRESH_SECRET` | Secret pour les refresh tokens |
| `PORT` | Port d'écoute (default 3000) |
| `SMTP_*` | Credentials SMTP pour les emails (invitations, reset password) |

## Docker

Build & run en production :

```bash
docker build -t buildr-api .
docker run -p 3000:3000 --env-file .env buildr-api
```

Ou via Docker Compose (avec Postgres inclus) :

```bash
docker compose up -d
```

## Frontend

Le client mobile (Expo / React Native) consomme cette API : voir [`buildr-ui`](https://github.com/Electrix67130/buildr-ui).
