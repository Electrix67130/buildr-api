import { z } from 'zod';

export const calendarProviderSchema = z.enum(['google', 'outlook', 'apple']);
export type CalendarProvider = z.infer<typeof calendarProviderSchema>;

export const startOAuthSchema = z.object({
  provider: z.enum(['google', 'outlook']),
});
export type StartOAuth = z.infer<typeof startOAuthSchema>;

export const oauthCallbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});
export type OAuthCallback = z.infer<typeof oauthCallbackSchema>;

export const disconnectSchema = z.object({
  provider: calendarProviderSchema,
});
export type Disconnect = z.infer<typeof disconnectSchema>;

export type CalendarIntegrationRow = {
  id: string;
  user_id: string;
  provider: CalendarProvider;
  refresh_token_encrypted: string | null;
  external_calendar_id: string | null;
  ical_token: string | null;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CalendarEventLinkRow = {
  id: string;
  integration_id: string;
  chantier_id: string;
  external_event_id: string;
  created_at: string;
  updated_at: string;
};

export type IntegrationPublic = {
  provider: CalendarProvider;
  connected: boolean;
  last_sync_at: string | null;
  ical_url?: string;
};
