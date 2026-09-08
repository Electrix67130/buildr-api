import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Environnement des tests.
 *
 * Ces valeurs sont posees dans `process.env` AVANT que quoi que ce soit
 * n'importe `@/config/env`. C'est ce qui neutralise le `.env` du poste :
 * dotenv n'ecrase jamais une variable deja definie, donc la base de test gagne
 * toujours sur la base de developpement.
 *
 * SMTP et Resend sont explicitement vides : sans eux, `sendMail()` se contente
 * de journaliser. Aucun test ne peut envoyer un vrai e-mail.
 */
const TEST_ENV = {
  NODE_ENV: 'test',
  DB_HOST: '127.0.0.1',
  DB_PORT: '5433',
  DB_NAME: 'buildr_test',
  DB_USER: 'postgres',
  DB_PASSWORD: 'postgres',
  JWT_SECRET: 'secret-de-test',
  API_KEY: 'cle-de-test',
  SMTP_HOST: '',
  RESEND_API_KEY: '',
  APP_URL: 'http://localhost:3001',
  API_PUBLIC_URL: 'http://localhost:3000',
  STORAGE_MODE: 'local',
};

// Pour le processus principal (global setup : migrations).
Object.assign(process.env, TEST_ENV);

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // Les projets heritent des plugins declares ci-dessus : inutile de les
    // redeclarer dans chacun.
    //
    // Deux etages separes : les unitaires ne touchent pas la base et tournent
    // sans docker, l'integration demarre le conteneur et applique les
    // migrations. Les separer evite d'exiger une base pour verifier une
    // fonction pure.
    projects: [
      {
        test: {
          name: 'unitaires',
          include: ['tests/unit/**/*.test.ts'],
          env: TEST_ENV,
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          env: TEST_ENV,
          globalSetup: ['./tests/global-setup.ts'],
          // `@fastify/autoload` decouvre les modules par import() a l'execution.
          // Sans cette ligne, cet import echappe au transformeur et Node bute
          // sur du TypeScript brut.
          server: { deps: { inline: ['@fastify/autoload'] } },
          // Une seule base pour toute la suite, et chaque test la vide avant de
          // commencer : les fichiers doivent donc s'executer l'un apres l'autre.
          fileParallelism: false,
          testTimeout: 20000,
          hookTimeout: 60000,
        },
      },
    ],
  },
});
