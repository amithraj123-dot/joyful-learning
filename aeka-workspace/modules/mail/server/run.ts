// One mailbox pass: delta sync, then a bounded triage run, under a per-member lease so overlapping
// ticks and actions never work on the same mailbox at once. Outlook throttling (429/503) sets a
// "busy" lease for the Retry-After time; nothing calls Outlook again for that member until it ends.
import { CloudError } from '../../../lib/cloud-store.ts';
import type { Member } from '../../../core/server/members.ts';
import { releaseLease, takeLease } from '../../../core/server/notifications.ts';
import { GraphError, GraphSession, ReauthError } from './graph.ts';
import { loadAccount, queueCounts, setAccountError, type Sys } from './store.ts';
import { CALENDAR_REFRESH_MS, syncCalendar } from './calendar.ts';
import { syncMailbox } from './sync.ts';
import { runTriage, type RunOptions } from './triage.ts';

const LEASE_MS = 3 * 60000;
const TICK_INTERVAL_MS = 2 * 60000;

export interface PassResult {
  fetched: number;
  triaged: number;
  pending: number;
  failed: number;
}

// Whether Outlook asked us to wait; takeLease with no length only succeeds once the wait is over.
const outlookWaiting = async (sys: Sys, email: string) =>
  !(await takeLease(sys.db, `mail-busy:${email}`, sys.now, 0));

export async function mailboxPass(
  sys: Sys,
  member: Member,
  o: RunOptions & { fromAction?: boolean } = {},
): Promise<PassResult | null> {
  const email = member.email;
  const account = await loadAccount(sys.db, email);
  if (!account || account.status !== 'connected') {
    if (o.fromAction)
      throw new CloudError(
        account?.status === 'reauth'
          ? 'Outlook needs you to sign in again. Reconnect first.'
          : 'Connect Outlook first.',
        409,
      );
    return null;
  }
  const lease = `mail:${email}`;
  if (!(await takeLease(sys.db, lease, sys.now, LEASE_MS))) {
    if (o.fromAction) throw new CloudError('Your mail is already being checked. Try again in a minute.', 409);
    return null;
  }
  const result: PassResult = { fetched: 0, triaged: 0, pending: 0, failed: 0 };
  let problem = '';
  try {
    const session = new GraphSession(sys, account);
    const due = o.fromAction || !account.last_sync_at || account.last_sync_at <= sys.now - TICK_INTERVAL_MS;
    if (due && !o.only && !(await outlookWaiting(sys, email))) {
      try {
        const s = await syncMailbox(session);
        result.fetched = s.fetched;
        if (s.busy) {
          await takeLease(sys.db, `mail-busy:${email}`, sys.now, s.busy.retryAfter * 1000);
          problem = s.busy.message;
        }
      } catch (e) {
        if (!(e instanceof GraphError)) throw e;
        problem =
          e.status === 0 ? 'Outlook could not be reached. Mail will be checked again shortly.' : e.message;
      }
    }
    // The calendar is refreshed at most every 15 minutes; its failures never affect mail.
    const calendarDue =
      !o.only &&
      account.calendar_status !== 'needs_consent' &&
      (!account.calendar_synced_at || account.calendar_synced_at <= sys.now - CALENDAR_REFRESH_MS);
    if (calendarDue && !(await outlookWaiting(sys, email))) await syncCalendar(session);
    const t = await runTriage(sys, member, account, session, o);
    result.triaged = t.triaged;
    if (t.aiError) problem ||= `AI triage is paused for now: ${t.aiError}`;
  } catch (e) {
    // Reconnecting is the member's step; the background pass simply stops until then.
    if (e instanceof ReauthError && !o.fromAction) return result;
    throw e;
  } finally {
    await releaseLease(sys.db, lease);
  }
  if (problem) await setAccountError(sys.db, email, problem, sys.now);
  else
    await sys.db
      .prepare(
        "UPDATE mail_accounts SET last_error = '' WHERE member = ? AND last_error NOT LIKE 'Sending a reply%'",
      )
      .bind(email)
      .run();
  const counts = await queueCounts(sys.db, email);
  result.pending = counts.pending;
  result.failed = counts.failed;
  return result;
}
