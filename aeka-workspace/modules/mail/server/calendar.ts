// The member's Outlook calendar, read only. A window from yesterday to 14 days ahead is cached in
// mail_events and replaced on each refresh (at most every 15 minutes in the background, or when an
// action needs fresh data). Event bodies are never fetched; times are kept in ms, read in India time.
import type { CalendarEvent, CalendarStatus } from '../shared/types.ts';
import { isBusy } from '../shared/types.ts';
import { calendarGranted, GraphError, type GraphSession } from './graph.ts';
import { addresses, DAY, MINUTE, type Sys } from './store.ts';

export const CALENDAR_REFRESH_MS = 15 * MINUTE;
const WINDOW_BEFORE = DAY;
const WINDOW_AFTER = 14 * DAY;
const MAX_PAGES = 5;
const MAX_ATTENDEES = 30;
const IST_MS = 330 * MINUTE;
const IST_PREFER = 'outlook.timezone="India Standard Time"';

// Start of the India day containing `ms`.
export const istDayStart = (ms: number) => Math.floor((ms + IST_MS) / DAY) * DAY - IST_MS;
// "2026-10-27T09:30:00.0000000" in India time to ms.
const istTime = (s: unknown) => {
  if (typeof s !== 'string') return NaN;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}(?::\d{2})?)/);
  return m ? Date.parse(`${m[1]}T${m[2].length === 5 ? m[2] + ':00' : m[2]}+05:30`) : NaN;
};
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const person = (v: unknown) => {
  const e = (v as { emailAddress?: { name?: unknown; address?: unknown } } | undefined)?.emailAddress;
  return { name: text(e?.name, 120), address: text(e?.address, 254).toLowerCase() };
};
const RESPONSES = ['organizer', 'accepted', 'tentative', 'declined', 'none'] as const;
const SHOW_AS = ['free', 'tentative', 'busy', 'oof', 'workingElsewhere', 'unknown'] as const;
const RESPONSE_MAP: Record<string, CalendarEvent['response']> = {
  organizer: 'organizer',
  accepted: 'accepted',
  tentativelyaccepted: 'tentative',
  declined: 'declined',
};

async function setStatus(sys: Sys, member: string, status: CalendarStatus, synced?: number) {
  await sys.db
    .prepare(
      'UPDATE mail_accounts SET calendar_status = ?, calendar_synced_at = coalesce(?, calendar_synced_at) WHERE member = ?',
    )
    .bind(status, synced ?? null, member)
    .run();
}

// Reads the window from Outlook and replaces the cache. Returns the status reached. Mail problems
// are never caused by the calendar: every failure is contained here.
export async function syncCalendar(session: GraphSession): Promise<CalendarStatus> {
  const { sys, account } = session;
  const member = account.member;
  if (!calendarGranted({ scope: await session.granted() })) {
    await setStatus(sys, member, 'needs_consent');
    return 'needs_consent';
  }
  const start = istDayStart(sys.now) - WINDOW_BEFORE;
  const end = istDayStart(sys.now) + WINDOW_AFTER;
  const select =
    'id,subject,start,end,isAllDay,location,onlineMeeting,onlineMeetingUrl,organizer,attendees,isOrganizer,responseStatus,showAs,isCancelled,webLink';
  let url: string | null =
    `/me/calendarView?startDateTime=${new Date(start).toISOString()}&endDateTime=${new Date(end).toISOString()}` +
    `&$select=${select}&$orderby=start/dateTime&$top=100`;
  const rows: unknown[] = [];
  try {
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const { data } = await session.request('GET', url, undefined, IST_PREFER);
      if (Array.isArray(data.value)) rows.push(...data.value);
      url = typeof data['@odata.nextLink'] === 'string' ? data['@odata.nextLink'] : null;
    }
  } catch (e) {
    if (e instanceof GraphError && e.status === 403) {
      await setStatus(sys, member, 'needs_consent');
      return 'needs_consent';
    }
    await setStatus(sys, member, 'error');
    return 'error';
  }
  const statements = [
    sys.db
      .prepare('DELETE FROM mail_events WHERE member = ? AND start_at < ? AND end_at > ?')
      .bind(member, end, start),
    // Events that ended before the window are no longer needed.
    sys.db.prepare('DELETE FROM mail_events WHERE member = ? AND end_at <= ?').bind(member, start),
  ];
  for (const raw of rows) {
    const e = raw as Record<string, unknown>;
    const id = text(e.id, 400);
    const s = istTime((e.start as { dateTime?: unknown } | undefined)?.dateTime);
    const f = istTime((e.end as { dateTime?: unknown } | undefined)?.dateTime);
    if (!id || !Number.isFinite(s) || !Number.isFinite(f) || f < s) continue;
    const attendees = (Array.isArray(e.attendees) ? e.attendees : [])
      .slice(0, MAX_ATTENDEES)
      .map(person)
      .filter((a) => a.address || a.name);
    const response =
      RESPONSE_MAP[
        String((e.responseStatus as { response?: unknown } | undefined)?.response).toLowerCase()
      ] ?? 'none';
    const showAs = (SHOW_AS as readonly string[]).includes(String(e.showAs)) ? String(e.showAs) : 'unknown';
    const online =
      text((e.onlineMeeting as { joinUrl?: unknown } | undefined)?.joinUrl, 2000) ||
      text(e.onlineMeetingUrl, 2000);
    statements.push(
      sys.db
        .prepare(
          `INSERT INTO mail_events(member,id,subject,start_at,end_at,all_day,location,online_url,organizer_json,
           attendees_json,is_organizer,response,show_as,cancelled,web_link,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(member,id) DO UPDATE SET subject = excluded.subject, start_at = excluded.start_at,
           end_at = excluded.end_at, all_day = excluded.all_day, location = excluded.location,
           online_url = excluded.online_url, organizer_json = excluded.organizer_json,
           attendees_json = excluded.attendees_json, is_organizer = excluded.is_organizer,
           response = excluded.response, show_as = excluded.show_as, cancelled = excluded.cancelled,
           web_link = excluded.web_link, updated_at = excluded.updated_at`,
        )
        .bind(
          member,
          id,
          text(e.subject, 300) || '(no title)',
          s,
          f,
          e.isAllDay === true ? 1 : 0,
          text((e.location as { displayName?: unknown } | undefined)?.displayName, 200),
          /^https:\/\//i.test(online) ? online : '',
          JSON.stringify(person(e.organizer)),
          JSON.stringify(attendees),
          e.isOrganizer === true ? 1 : 0,
          e.isOrganizer === true ? 'organizer' : response,
          showAs,
          e.isCancelled === true ? 1 : 0,
          /^https:\/\//i.test(text(e.webLink, 2000)) ? text(e.webLink, 2000) : '',
          sys.now,
        ),
    );
  }
  await sys.db.batch(statements);
  await setStatus(sys, member, 'ready', sys.now);
  return 'ready';
}

interface EventRow {
  id: string;
  subject: string;
  start_at: number;
  end_at: number;
  all_day: number;
  location: string;
  online_url: string;
  organizer_json: string;
  attendees_json: string;
  is_organizer: number;
  response: string;
  show_as: string;
  cancelled: number;
  web_link: string;
}

// Cached events overlapping [from, to), earliest first. `link` maps an address to a mandate.
export async function cachedEvents(
  db: D1Database,
  member: string,
  from: number,
  to: number,
  link: (address: string) => Promise<{ id: string; label: string } | null>,
): Promise<CalendarEvent[]> {
  const r = await db
    .prepare(
      'SELECT * FROM mail_events WHERE member = ? AND start_at < ? AND end_at > ? ORDER BY start_at, end_at LIMIT 200',
    )
    .bind(member, to, from)
    .all<EventRow>();
  const out: CalendarEvent[] = [];
  for (const row of r.results) {
    const organizer = addresses(`[${row.organizer_json}]`)[0] ?? { name: '', address: '' };
    const attendees = addresses(row.attendees_json);
    let matter: { id: string; label: string } | null = null;
    for (const a of [organizer, ...attendees]) {
      if (!a.address || a.address === member) continue;
      matter = await link(a.address);
      if (matter) break;
    }
    out.push({
      id: row.id,
      subject: row.subject,
      start: row.start_at,
      end: row.end_at,
      allDay: !!row.all_day,
      location: row.location,
      onlineUrl: row.online_url,
      organizer,
      attendees,
      isOrganizer: !!row.is_organizer,
      response: (RESPONSES as readonly string[]).includes(row.response)
        ? (row.response as CalendarEvent['response'])
        : 'none',
      showAs: (SHOW_AS as readonly string[]).includes(row.show_as)
        ? (row.show_as as CalendarEvent['showAs'])
        : 'unknown',
      cancelled: !!row.cancelled,
      webLink: row.web_link,
      matterId: matter?.id ?? null,
      matterLabel: matter?.label ?? '',
    });
  }
  return out;
}

// Free periods of at least `minutes` on one India day within working hours, from `notBefore`.
// Busy time is every timed event that is not cancelled, declined or marked free.
export function freeSlots(
  events: Pick<CalendarEvent, 'start' | 'end' | 'allDay' | 'cancelled' | 'response' | 'showAs'>[],
  day: number, // start of the India day (ms)
  minutes: number,
  hours: { from: number; to: number }, // minutes after midnight, India time
  notBefore: number,
) {
  const open = Math.max(day + hours.from * MINUTE, Math.ceil(notBefore / (5 * MINUTE)) * 5 * MINUTE);
  const close = day + hours.to * MINUTE;
  const busy = events
    .filter((e) => !e.allDay && isBusy(e) && e.end > open && e.start < close)
    .map((e) => [Math.max(e.start, open), Math.min(e.end, close)] as const)
    .sort((a, b) => a[0] - b[0]);
  const slots: { start: number; end: number }[] = [];
  let cursor = open;
  for (const [s, f] of busy) {
    if (s - cursor >= minutes * MINUTE) slots.push({ start: cursor, end: s });
    cursor = Math.max(cursor, f);
  }
  if (close - cursor >= minutes * MINUTE) slots.push({ start: cursor, end: close });
  return slots;
}

// Pairs of timed, busy events that overlap.
export function clashes(events: CalendarEvent[]) {
  const timed = events.filter((e) => !e.allDay && isBusy(e)).sort((a, b) => a.start - b.start);
  const out: [CalendarEvent, CalendarEvent][] = [];
  for (let i = 0; i < timed.length; i++)
    for (let j = i + 1; j < timed.length && timed[j].start < timed[i].end; j++)
      out.push([timed[i], timed[j]]);
  return out;
}
