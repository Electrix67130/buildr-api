import { z } from 'zod';

export const addTeamMemberSchema = z.object({
  manager_id: z.string().uuid(),
  user_id: z.string().uuid(),
});

export type AddTeamMember = z.infer<typeof addTeamMemberSchema>;

export type TeamMemberRow = {
  id: string;
  manager_id: string;
  user_id: string;
  created_at: string;
};
