import { z } from 'zod';

export const createStepSchema = z.object({
  chantier_id: z.string().uuid(),
  name: z.string().min(1).max(200),
});

export const updateStepSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  validation_comment: z.string().max(2000).nullable().optional(),
});

export const reorderStepsSchema = z.object({
  ordered_ids: z.array(z.string().uuid()).min(1),
});

export const createSubstepSchema = z.object({
  step_id: z.string().uuid(),
  name: z.string().min(1).max(300),
});

export const updateSubstepSchema = z.object({
  name: z.string().min(1).max(300).optional(),
  validation_comment: z.string().max(2000).nullable().optional(),
});

export const reorderSubstepsSchema = z.object({
  ordered_ids: z.array(z.string().uuid()).min(1),
});

export const toggleSubstepSchema = z.object({
  validated: z.boolean(),
  validation_comment: z.string().max(2000).nullable().optional(),
});

export const toggleStepSchema = z.object({
  validated: z.boolean(),
  validation_comment: z.string().max(2000).nullable().optional(),
});

export type CreateStep = z.infer<typeof createStepSchema>;
export type UpdateStep = z.infer<typeof updateStepSchema>;
export type ReorderSteps = z.infer<typeof reorderStepsSchema>;
export type CreateSubstep = z.infer<typeof createSubstepSchema>;
export type UpdateSubstep = z.infer<typeof updateSubstepSchema>;
export type ReorderSubsteps = z.infer<typeof reorderSubstepsSchema>;
export type ToggleSubstep = z.infer<typeof toggleSubstepSchema>;
export type ToggleStep = z.infer<typeof toggleStepSchema>;

export type ChantierStepRow = {
  id: string;
  chantier_id: string;
  name: string;
  position: number;
  validated_at: string | null;
  validated_by: string | null;
  validation_comment: string | null;
  created_at: string;
  updated_at: string;
};

export type ChantierSubstepRow = {
  id: string;
  step_id: string;
  name: string;
  position: number;
  validated_at: string | null;
  validated_by: string | null;
  validation_comment: string | null;
  created_at: string;
  updated_at: string;
};

export type StepWithSubsteps = ChantierStepRow & {
  substeps: ChantierSubstepRow[];
};
