import { z } from 'zod';

export const registerPushTokenSchema = z.object({
  token: z.string().min(1).max(500),
  platform: z.enum(['ios', 'android', 'web']).optional(),
});

export const unregisterPushTokenSchema = z.object({
  token: z.string().min(1).max(500),
});

export type RegisterPushToken = z.infer<typeof registerPushTokenSchema>;
export type UnregisterPushToken = z.infer<typeof unregisterPushTokenSchema>;
