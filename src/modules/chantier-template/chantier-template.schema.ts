import { z } from 'zod';

const chantierStatusEnum = z.enum(['a_venir', 'en_cours', 'termine']);

const substepInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(300),
});

const stepInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  substeps: z.array(substepInputSchema).optional().default([]),
});

const memberInputSchema = z.object({
  user_id: z.string().uuid(),
});

export const createTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  default_status: chantierStatusEnum.optional().default('a_venir'),
  steps: z.array(stepInputSchema).optional().default([]),
  members: z.array(memberInputSchema).optional().default([]),
});

export const updateTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  default_status: chantierStatusEnum.optional(),
  steps: z.array(stepInputSchema).optional(),
  members: z.array(memberInputSchema).optional(),
});

export const useTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  postal_code: z.string().max(10).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

export type CreateTemplate = z.infer<typeof createTemplateSchema>;
export type UpdateTemplate = z.infer<typeof updateTemplateSchema>;
export type UseTemplate = z.infer<typeof useTemplateSchema>;

export type TemplateRow = {
  id: string;
  organization_id: string;
  created_by: string;
  name: string;
  description: string | null;
  default_status: 'a_venir' | 'en_cours' | 'termine';
  created_at: string;
  updated_at: string;
};

export type TemplateStepRow = {
  id: string;
  template_id: string;
  name: string;
  position: number;
  created_at: string;
};

export type TemplateSubstepRow = {
  id: string;
  template_step_id: string;
  name: string;
  position: number;
  created_at: string;
};

export type TemplateMemberRow = {
  id: string;
  template_id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
};

export type TemplateMemberWithUser = TemplateMemberRow & {
  first_name: string;
  last_name: string;
  email: string;
  role: string;
};

export type TemplateWithSteps = TemplateRow & {
  steps: (TemplateStepRow & { substeps: TemplateSubstepRow[] })[];
  members: TemplateMemberWithUser[];
};
