import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.string().email().max(255),
  password_hash: z.string().min(1),
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  phone: z.string().max(20).optional(),
  avatar_url: z.string().url().max(500).optional(),
  role: z.enum(['admin', 'manager', 'employee', 'client', 'gestionnaire_reseau']).optional().default('employee'),
  company_name: z.string().max(200).optional(),
});

export const updateUserSchema = z.object({
  email: z.string().email().max(255).optional(),
  first_name: z.string().min(1).max(100).optional(),
  last_name: z.string().min(1).max(100).optional(),
  phone: z.string().max(20).optional(),
  avatar_url: z.string().url().max(500).nullable().optional(),
  role: z.enum(['admin', 'manager', 'employee', 'client', 'gestionnaire_reseau']).optional(),
  company_name: z.string().max(200).optional(),
  is_active: z.boolean().optional(),
});

// Suppression de son propre compte : on redemande le mot de passe pour qu'un token
// vole ne suffise pas a detruire un compte.
export const deleteAccountSchema = z.object({
  password: z.string().min(1),
});

export type CreateUser = z.infer<typeof createUserSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;
export type DeleteAccount = z.infer<typeof deleteAccountSchema>;

export type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  phone?: string;
  avatar_url?: string | null;
  role: 'admin' | 'manager' | 'employee' | 'client' | 'gestionnaire_reseau';
  company_name?: string;
  is_active: boolean;
  organization_id: string;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Retire d'une ligne `user` tout ce qui ne doit jamais sortir de l'API :
 * le hash du mot de passe, et les identifiants de session par plateforme —
 * ce sont des donnees internes au controle d'authentification, aucun client
 * n'en a l'usage.
 */
export function toPublicUser<T extends Record<string, unknown>>(user: T) {
  const {
    password_hash: _password_hash,
    current_mobile_session_id: _mobileSession,
    current_web_session_id: _webSession,
    ...rest
  } = user as T & {
    password_hash?: string;
    current_mobile_session_id?: string | null;
    current_web_session_id?: string | null;
  };
  return rest;
}
