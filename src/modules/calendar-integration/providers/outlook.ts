import env from '@/config/env';

const AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const API_BASE = 'https://graph.microsoft.com/v1.0';
const SCOPES = ['Calendars.ReadWrite', 'offline_access', 'openid'].join(' ');

export const OUTLOOK_REDIRECT_PATH = '/calendar/oauth/outlook/callback';

export function outlookRedirectUri(): string {
  return `${env.CALENDAR_OAUTH_REDIRECT_BASE}${OUTLOOK_REDIRECT_PATH}`;
}

export function buildOutlookAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.OUTLOOK_CLIENT_ID,
    redirect_uri: outlookRedirectUri(),
    response_type: 'code',
    response_mode: 'query',
    scope: SCOPES,
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export interface OutlookTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

export async function exchangeCodeForTokens(code: string): Promise<OutlookTokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: env.OUTLOOK_CLIENT_ID,
    client_secret: env.OUTLOOK_CLIENT_SECRET,
    redirect_uri: outlookRedirectUri(),
    grant_type: 'authorization_code',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Outlook token exchange failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<OutlookTokenResponse>;
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: env.OUTLOOK_CLIENT_ID,
    client_secret: env.OUTLOOK_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Outlook refresh failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export interface CalendarEventInput {
  summary: string;
  description?: string;
  location?: string;
  startDate: string;
  endDate: string;
}

function toOutlookEvent(input: CalendarEventInput) {
  const endExclusive = new Date(input.endDate);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const endStr = endExclusive.toISOString().slice(0, 10);
  return {
    subject: input.summary,
    body: input.description ? { contentType: 'Text', content: input.description } : undefined,
    location: input.location ? { displayName: input.location } : undefined,
    isAllDay: true,
    start: { dateTime: `${input.startDate}T00:00:00`, timeZone: 'UTC' },
    end: { dateTime: `${endStr}T00:00:00`, timeZone: 'UTC' },
  };
}

export async function createEvent(accessToken: string, input: CalendarEventInput): Promise<string> {
  const res = await fetch(`${API_BASE}/me/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(toOutlookEvent(input)),
  });
  if (!res.ok) throw new Error(`Outlook create event failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { id: string };
  return data.id;
}

export async function updateEvent(accessToken: string, eventId: string, input: CalendarEventInput): Promise<void> {
  const res = await fetch(`${API_BASE}/me/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(toOutlookEvent(input)),
  });
  if (!res.ok && res.status !== 404) throw new Error(`Outlook update event failed: ${res.status} ${await res.text()}`);
}

export async function deleteEvent(accessToken: string, eventId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/me/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Outlook delete event failed: ${res.status} ${await res.text()}`);
  }
}

export function isConfigured(): boolean {
  return Boolean(env.OUTLOOK_CLIENT_ID && env.OUTLOOK_CLIENT_SECRET);
}
