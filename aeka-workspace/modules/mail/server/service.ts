// Mail's services for other modules (the assistant). Each works on the caller's own mailbox and
// reads only stored data (no Graph call), except draftReplyFor, which drafts with the AI, and the
// calendar functions, which may refresh the cached calendar first.
// SIGNATURES ARE FIXED.
import type { ModuleContext } from '../../../core/server/module.ts';
import { matterTargets } from '../../workflow/server/services.ts';
import type {
  CalendarEvent,
  CalendarStatus,
  Draft,
  MailItem,
  MailView,
  QueueCounts,
} from '../shared/types.ts';
import { VIEWS } from '../shared/types.ts';
import { cachedEvents, freeSlots, istDayStart, syncCalendar } from './calendar.ts';
import { createDraft } from './drafts.ts';
import { GraphSession, ReauthError } from './graph.ts';
import { confirmedLink } from './rules.ts';
import { listFollowUps } from './followups.ts';
import { itemsWith, listItems, loadAccount, queueCounts } from './store.ts';

const memberEmail = (ctx: ModuleContext) => ctx.member?.email ?? '';
const bound = (n: number, max: number) =>
  Number.isInteger(n) && n > 0 ? Math.min(n, max) : Math.min(10, max);

// Whether the caller has a connected Outlook account.
export async function mailConnected(ctx: ModuleContext): Promise<boolean> {
  const email = memberEmail(ctx);
  if (!email) return false;
  return (await loadAccount(ctx.db, email))?.status === 'connected';
}
// Queue counts, or null when no mailbox is connected.
export async function mailCounts(ctx: ModuleContext): Promise<QueueCounts | null> {
  const email = memberEmail(ctx);
  if (!email || !(await loadAccount(ctx.db, email))) return null;
  return queueCounts(ctx.db, email);
}
// Triaged mail in a view, newest first (urgent first within needs_me).
export async function mailQueue(ctx: ModuleContext, view: MailView, limit = 10): Promise<MailItem[]> {
  const email = memberEmail(ctx);
  if (!email || !(VIEWS as readonly string[]).includes(view)) return [];
  return listItems(ctx.db, email, { view, limit: bound(limit, 50), urgentFirst: view === 'needs_me' });
}
// Mail whose subject, sender or triage summary matches every word of the query.
export async function searchMail(ctx: ModuleContext, query: string, limit = 8): Promise<MailItem[]> {
  const email = memberEmail(ctx);
  const q = typeof query === 'string' ? query.trim().slice(0, 200) : '';
  if (!email || !q) return [];
  return listItems(ctx.db, email, { view: 'all', search: q, limit: bound(limit, 30) });
}
// Drafts a reply to one of the caller's emails (records "wanted" as the draft decision). Never sends.
export async function draftReplyFor(
  ctx: ModuleContext,
  mailId: string,
  instructions?: string,
): Promise<Draft> {
  return createDraft(ctx, mailId, instructions);
}

// Calendar access for the caller: 'not_connected' without an Outlook account.
export async function calendarStatus(ctx: ModuleContext): Promise<CalendarStatus | 'not_connected'> {
  const email = memberEmail(ctx);
  const account = email ? await loadAccount(ctx.db, email) : null;
  if (!account || account.status !== 'connected') return 'not_connected';
  return account.calendar_status ?? 'pending';
}

// The caller's calendar events overlapping [from, to), earliest first, from the cached window
// (yesterday to 14 days ahead). With `fresh`, a cache older than 5 minutes is refreshed first when
// possible; a failed refresh falls back to the cache.
export async function eventsBetween(
  ctx: ModuleContext,
  from: number,
  to: number,
  fresh = false,
): Promise<CalendarEvent[]> {
  const email = memberEmail(ctx);
  const account = email ? await loadAccount(ctx.db, email) : null;
  if (!account || account.status !== 'connected' || account.calendar_status === 'needs_consent') return [];
  if (fresh && (!account.calendar_synced_at || account.calendar_synced_at < ctx.now - 5 * 60000)) {
    try {
      await syncCalendar(
        new GraphSession({ db: ctx.db, env: ctx.env, fetch: ctx.fetch, now: ctx.now }, account),
      );
    } catch (e) {
      if (!(e instanceof ReauthError)) console.error('Calendar refresh failed');
    }
  }
  const targets = await matterTargets(ctx).catch(() => []);
  const labels = new Map(targets.map((t) => [t.matterId, `${t.clientName}: ${t.title}`]));
  const visible = new Set(labels.keys());
  const seen = new Map<string, { id: string; label: string } | null>();
  const link = async (address: string) => {
    if (!seen.has(address)) {
      const id = await confirmedLink(ctx.db, email, address, visible);
      seen.set(address, id ? { id, label: labels.get(id) ?? '' } : null);
    }
    return seen.get(address)!;
  };
  return cachedEvents(ctx.db, email, from, to, link);
}

// Free periods of at least `minutes` on the India day containing `day`, within working hours
// (default 09:30 to 19:00), not before now.
export async function freeTime(
  ctx: ModuleContext,
  day: number,
  minutes: number,
  hours = { from: 9 * 60 + 30, to: 19 * 60 },
) {
  const start = istDayStart(day);
  const events = await eventsBetween(ctx, start, start + 24 * 3600000, true);
  return freeSlots(events, start, minutes, hours, ctx.now);
}

// ---- Follow-ups and correspondence (SIGNATURES FIXED; implemented by the mail server work) ----

// My follow-ups (see FollowUp in shared/types.ts), most pressing first. Not snoozed or done ones.
export async function followUps(
  ctx: ModuleContext,
  kind?: import('../shared/types.ts').FollowUpKind,
  limit = 20,
): Promise<import('../shared/types.ts').FollowUp[]> {
  const email = memberEmail(ctx);
  if (!email || !(await loadAccount(ctx.db, email))) return [];
  const k = kind === 'waiting' || kind === 'chasing' ? kind : undefined;
  const list = await listFollowUps(ctx, { kind: k, limit: bound(limit, 100) });
  return list.map((f) => {
    const out: Partial<typeof f> = { ...f };
    delete out.done;
    return out as import('../shared/types.ts').FollowUp;
  });
}
// My most recent emails received from or sent to any of these addresses (lower case), newest first.
export async function mailWith(ctx: ModuleContext, addresses: string[], limit = 8): Promise<MailItem[]> {
  const email = memberEmail(ctx);
  if (!email || !Array.isArray(addresses)) return [];
  const list = addresses.filter((a): a is string => typeof a === 'string' && a.length <= 254);
  return itemsWith(ctx.db, email, list, bound(limit, 30));
}
