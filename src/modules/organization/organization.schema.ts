import { z } from 'zod';

export const createOrganizationSchema = z.object({
  name: z.string().min(1).max(200),
});

export const updateOrganizationSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  archive_retention_years: z.number().int().min(1).max(10).optional(),
});

export type CreateOrganization = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganization = z.infer<typeof updateOrganizationSchema>;

export type OrganizationRow = {
  id: string;
  name: string;
  archive_retention_years: number;
  created_at: string;
  updated_at: string;
};
