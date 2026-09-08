import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';

/** Mot de passe commun a tous les comptes de test. */
export const TEST_PASSWORD = 'MotDePasse123!';

// Deux economies, car chaque compte de test se connecte pour de vrai.
//
// Le condensat n'est calcule qu'une fois pour toute la suite : tous les comptes
// partagent le meme mot de passe. Et il l'est avec un cout de 4 au lieu de 12 —
// c'est le cout inscrit DANS le condensat qui determine le prix de
// `bcrypt.compare` a chaque connexion, soit quelques millisecondes au lieu de
// 250. La production continue de hacher a 12, ce n'est pas ce qui est verifie
// ici.
const TEST_BCRYPT_COST = 4;
let sharedHash: string | null = null;
async function passwordHash(): Promise<string> {
  if (!sharedHash) sharedHash = await bcrypt.hash(TEST_PASSWORD, TEST_BCRYPT_COST);
  return sharedHash;
}

let emailCounter = 0;
function nextEmail(prefix: string): string {
  emailCounter += 1;
  return `${prefix}${emailCounter}@test.local`;
}

export interface TestUser {
  id: string;
  email: string;
  role: string;
  organizationId: string;
  /** Jeton d'acces obtenu par un vrai POST /auth/login. */
  token: string;
}

/** Cree une organisation et renvoie son identifiant. */
export async function createOrganization(app: FastifyInstance, name: string): Promise<string> {
  const [org] = await app.db('organization').insert({ name }).returning('id');
  return org.id as string;
}

/**
 * Cree un utilisateur rattache a une organisation avec un role donne, puis
 * l'authentifie.
 *
 * L'insertion est directe en base — construire chaque compte via l'API
 * demanderait une invitation par utilisateur et rendrait les tests dependants
 * du parcours qu'ils sont parfois censes verifier. La connexion, elle, passe
 * bien par l'API : c'est le jeton reel qui est teste.
 */
export async function createUser(
  app: FastifyInstance,
  params: { organizationId: string; role: string; email?: string; locale?: string },
): Promise<TestUser> {
  const email = params.email ?? nextEmail(params.role);
  const [user] = await app
    .db('user')
    .insert({
      email,
      password_hash: await passwordHash(),
      first_name: 'Test',
      last_name: params.role,
      phone: '0600000000',
      role: params.role, // colonne vestigiale : la verite est organization_member
      organization_id: params.organizationId,
      active_organization_id: params.organizationId,
      locale: params.locale ?? 'fr',
    })
    .returning('id');

  await app.db('organization_member').insert({
    organization_id: params.organizationId,
    user_id: user.id,
    role: params.role,
  });

  const token = await login(app, email);

  return { id: user.id as string, email, role: params.role, organizationId: params.organizationId, token };
}

/** Cree une organisation et son administrateur d'un coup. */
export async function createOrgWithAdmin(
  app: FastifyInstance,
  name: string,
): Promise<{ organizationId: string; admin: TestUser }> {
  const organizationId = await createOrganization(app, name);
  const admin = await createUser(app, { organizationId, role: 'admin' });
  return { organizationId, admin };
}

/**
 * Cree un super admin : un compte ordinaire, plus le drapeau qui ouvre la
 * console. En production ce drapeau est pose a la main en SQL, il n'existe
 * aucune route pour l'accorder.
 */
export async function createSuperAdmin(app: FastifyInstance, organizationId: string): Promise<TestUser> {
  const compte = await createUser(app, { organizationId, role: 'admin' });
  await app.db('user').where({ id: compte.id }).update({ is_super_admin: true });
  return compte;
}

/** Authentifie un compte de test et renvoie son jeton d'acces. */
export async function login(app: FastifyInstance, email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password: TEST_PASSWORD, platform: 'web' },
  });
  if (res.statusCode !== 200) {
    throw new Error(`Connexion impossible pour ${email} : ${res.statusCode} ${res.body}`);
  }
  return res.json().access_token as string;
}
