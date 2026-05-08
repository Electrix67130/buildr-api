import { Knex } from 'knex';
import { ChantierRow } from '@/modules/chantier/chantier.schema';

function escapeIcs(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function fmtDate(date: string | Date): string {
  // Knex renvoie les colonnes PostgreSQL `date` comme des Date JS — on coerce.
  const s = typeof date === 'string' ? date : date.toISOString().slice(0, 10);
  return s.replaceAll('-', '');
}

function fmtUtc(timestamp: string): string {
  return new Date(timestamp).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

interface IcsEventInput {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  startDate: string;
  endDate: string;
  updatedAt: string;
}

function eventBlock(e: IcsEventInput): string {
  const endExclusive = new Date(e.endDate);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const endStr = endExclusive.toISOString().slice(0, 10);
  const lines = [
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `DTSTAMP:${fmtUtc(e.updatedAt)}`,
    `DTSTART;VALUE=DATE:${fmtDate(e.startDate)}`,
    `DTEND;VALUE=DATE:${fmtDate(endStr)}`,
    `SUMMARY:${escapeIcs(e.summary)}`,
  ];
  if (e.description) lines.push(`DESCRIPTION:${escapeIcs(e.description)}`);
  if (e.location) lines.push(`LOCATION:${escapeIcs(e.location)}`);
  lines.push('END:VEVENT');
  return lines.join('\r\n');
}

/** Build the iCal feed listing every active chantier the user is a member of (or creator). */
export async function buildIcsForUser(db: Knex, userId: string): Promise<string> {
  const chantiers: ChantierRow[] = await db('chantier')
    .whereNull('archived_at')
    .where((qb) => {
      qb.where('created_by', userId).orWhereExists(function () {
        this.select('*')
          .from('chantier_member')
          .whereRaw('chantier_member.chantier_id = chantier.id')
          .where('chantier_member.user_id', userId);
      });
    });

  const events = chantiers
    .filter((c) => c.start_date && c.end_date)
    .map((c) =>
      eventBlock({
        uid: `chantier-${c.id}@buildr`,
        summary: c.name,
        description: c.description,
        location: [c.address, c.postal_code, c.city].filter(Boolean).join(', ') || undefined,
        startDate: c.start_date as string,
        endDate: c.end_date as string,
        updatedAt: c.updated_at,
      }),
    );

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Buildr//Calendrier chantiers//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Buildr — Mes chantiers',
    ...events,
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}
