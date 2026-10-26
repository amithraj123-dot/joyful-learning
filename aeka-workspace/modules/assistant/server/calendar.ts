// Calendar awareness for the assistant: today's meetings in the brief, clashes and free time, and a
// notice shortly before each meeting. The calendar is read through Mail's services (read only).
import type { SystemContext } from '../../../core/server/env.ts';
import type { Member } from '../../../core/server/members.ts';
import type { ModuleContext } from '../../../core/server/module.ts';
import { notify } from '../../../core/server/notifications.ts';
import { calendarStatus, eventsBetween, freeTime } from '../../mail/server/service.ts';
import { clashes } from '../../mail/server/calendar.ts';
import { isBusy, type CalendarEvent } from '../../mail/shared/types.ts';
import type { BriefLine } from '../shared/types.ts';
import { memberContext } from './context.ts';
import { DAY, MINUTE, istDayStart, timeLabel } from './recurrence.ts';
import { readSettings } from './settings.ts';

export const MEETING_LEAD_MINUTES = 10;

// Mail's services can fail (Outlook not connected, a refresh failing); the calendar part is then left out.
async function attempt<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

const where = (e: CalendarEvent) => (e.onlineUrl ? 'online' : e.location);
export const eventSpan = (e: CalendarEvent) =>
  e.allDay ? 'All day' : `${timeLabel(e.start)} to ${timeLabel(e.end)}`;

// One line for an event: "9:30 am to 10:00 am: Falcon SPA call (online), Vista Earth: Project Falcon".
export function eventLine(e: CalendarEvent) {
  const extra = [where(e), e.response === 'tentative' ? 'tentative' : ''].filter(Boolean).join(', ');
  return `${eventSpan(e)}: ${e.subject}${extra ? ` (${extra})` : ''}${e.matterLabel ? `, ${e.matterLabel}` : ''}`;
}

// The calendar part of the brief for today. Empty without an Outlook calendar.
export async function calendarSection(ctx: ModuleContext, fresh: boolean): Promise<BriefLine[]> {
  const status = await attempt(() => calendarStatus(ctx));
  if (!status || status === 'not_connected') return [];
  if (status === 'needs_consent')
    return [
      {
        text: 'Allow calendar access in Outlook connection to see your meetings here.',
        link: 'mail/connect',
      },
    ];
  const start = istDayStart(ctx.now);
  const events = ((await attempt(() => eventsBetween(ctx, start, start + DAY, fresh))) ?? []).filter(
    (e) => !e.cancelled && e.response !== 'declined',
  );
  if (!events.length) return status === 'ready' ? [{ text: 'No meetings today.' }] : [];
  const lines: BriefLine[] = events
    .slice(0, 10)
    .map((e) => ({ text: eventLine(e), ...(e.matterId ? { link: `workflow/matters#${e.matterId}` } : {}) }));
  if (events.length > 10) lines.push({ text: `and ${events.length - 10} more` });
  for (const [a, b] of clashes(events).slice(0, 3))
    lines.push({ text: `Clash: "${a.subject}" and "${b.subject}" overlap at ${timeLabel(b.start)}.` });
  const slots = (await attempt(() => freeTime(ctx, ctx.now, 30))) ?? [];
  if (events.some((e) => !e.allDay && isBusy(e)) && slots.length)
    lines.push({
      text:
        'Free time: ' +
        slots
          .slice(0, 4)
          .map((s) => `${timeLabel(s.start)} to ${timeLabel(s.end)}`)
          .join(', '),
    });
  return lines;
}

// A notice about 10 minutes before each meeting the member has not declined, once per meeting time.
export async function meetingAlerts(sys: SystemContext, member: Member) {
  const row = await readSettings(sys.db, member.email);
  if (!row.settings.meetingAlerts) return 0;
  const ctx = memberContext(sys, member);
  const soon =
    (await attempt(() => eventsBetween(ctx, sys.now, sys.now + (MEETING_LEAD_MINUTES + 2) * MINUTE))) ?? [];
  let sent = 0;
  for (const e of soon) {
    if (e.allDay || e.start <= sys.now || e.start > sys.now + (MEETING_LEAD_MINUTES + 2) * MINUTE) continue;
    if (e.cancelled || e.response === 'declined') continue;
    const minutes = Math.max(1, Math.round((e.start - sys.now) / MINUTE));
    const id = await notify(
      sys.db,
      {
        recipient: member.email,
        module: 'assistant',
        kind: 'meeting',
        title: `In ${minutes} minutes: ${e.subject}`,
        body: [eventSpan(e), where(e), e.matterLabel].filter(Boolean).join(' · '),
        link: e.matterId ? `workflow/matters#${e.matterId}` : 'assistant/today',
        dedupeKey: `meeting:${e.id}:${e.start}`,
      },
      sys.now,
    );
    if (id) sent++;
  }
  return sent;
}
