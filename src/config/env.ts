import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().default(5432),
  DB_NAME: z.string().default('buildr'),
  DB_USER: z.string().default('postgres'),
  DB_PASSWORD: z.string().default('postgres'),
  JWT_SECRET: z.string().default('change-me-in-production'),
  JWT_ACCESS_EXPIRES: z.string().default('15m'),
  API_KEY: z.string().default('change-me-in-production'),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  SMTP_FROM: z.string().default('noreply@getbuildr.fr'),
  RESEND_API_KEY: z.string().default(''),
  CORS_ORIGINS: z.string().default(''),
  /** Base publique du dashboard web. Sert aux liens envoyes par email
   *  (invitations, reinitialisation de mot de passe). */
  APP_URL: z.string().default('http://localhost:3001'),
  /** Base publique de cette API. Sert a construire les URLs de fichiers
   *  (photos, documents) : elles doivent pointer vers l'API, pas vers le
   *  dashboard. A defaut, on retombe sur APP_URL pour ne pas casser les
   *  installations qui n'ont pas encore la variable. */
  API_PUBLIC_URL: z.string().default(''),
  STORAGE_MODE: z.enum(['local', 's3']).default('local'),
  S3_BUCKET: z.string().default(''),
  S3_REGION: z.string().default('eu-west-3'),
  S3_ACCESS_KEY: z.string().default(''),
  S3_SECRET_KEY: z.string().default(''),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  OUTLOOK_CLIENT_ID: z.string().default(''),
  OUTLOOK_CLIENT_SECRET: z.string().default(''),
  CALENDAR_OAUTH_REDIRECT_BASE: z.string().default('http://localhost:3001'),
  CALENDAR_ENCRYPTION_KEY: z.string().default(''),
});

const parsed = envSchema.parse(process.env);

const env = {
  ...parsed,
  API_PUBLIC_URL: parsed.API_PUBLIC_URL || parsed.APP_URL,
};

export type Env = z.infer<typeof envSchema>;
export default env;
