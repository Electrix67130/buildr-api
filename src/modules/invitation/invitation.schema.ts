import { z } from 'zod';

export const createInvitationSchema = z.object({
  email: z.string().email().max(255),
  role: z.enum(['admin', 'manager', 'employee', 'client', 'gestionnaire_reseau']).optional().default('employee'),
});

export type CreateInvitation = z.infer<typeof createInvitationSchema>;

export type InvitationRow = {
  id: string;
  email: string;
  invited_by: string;
  role: 'admin' | 'manager' | 'employee' | 'client' | 'gestionnaire_reseau';
  token: string;
  status: 'pending' | 'accepted' | 'expired';
  expires_at: string;
  organization_id: string;
  created_at: string;
};
