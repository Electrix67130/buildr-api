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
  avatar_url: z.string().url().max(500).optional(),
  role: z.enum(['admin', 'manager', 'employee', 'client', 'gestionnaire_reseau']).optional(),
  company_name: z.string().max(200).optional(),
  is_active: z.boolean().optional(),
});

export type CreateUser = z.infer<typeof createUserSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;

export type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  phone?: string;
  avatar_url?: string;
  role: 'admin' | 'manager' | 'employee' | 'client' | 'gestionnaire_reseau';
  company_name?: string;
  is_active: boolean;
  organization_id: string;
  created_at: string;
  updated_at: string;
};
