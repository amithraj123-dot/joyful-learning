// Nudges: a chat that needs my reply is nudged up to three times for each wait, sooner for higher
// tiers, as workspace notifications (which the phone shows natively). Quiet hours (10 pm to 7:30 am
// India time) hold them; when quiet hours end, only the latest level due is sent, never a backlog.
// A VIP chat is nudged one tier sooner; a "maybe" one tier later.
import { notify } from '../../../core/server/notifications.ts';
import { APP_LABELS, type AppId, type ChatSettings, type Tier } from '../shared/types.ts';
import { HOUR, MINUTE, NEEDS_ME, indiaTime, waitLabel, type Row, type Sys } from './store.ts';

// Hours after the first unanswered message for nudges 1, 2 and 3.
export const SCHEDULE: Record<Tier, number[]> = {
  1: [0.25, 2, 6],
  2: [1, 6, 24],
  3: [4, 24, 72],
  4: [24, 72],
};

export function quietNow(now: number) {
  const d = new Date(now + 330 * MINUTE);
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return minutes >= 22 * 60 || minutes < 7 * 60 + 30;
}

// The schedule for a chat (exported for tests).
export function scheduleFor(tier: Tier, vip: boolean, maybe: boolean): number[] {
  let t = tier as number;
  if (vip) t -= 1;
  if (maybe) t += 1;
  return SCHEDULE[Math.min(4, Math.max(1, t)) as Tier];
}

const LEVEL_TITLES = ['Reply to', 'Still waiting:', 'Last reminder:'];

export async function runNudges(sys: Sys, member: string, settings: ChatSettings) {
  if (!settings.nudges) return 0;
  const quiet = settings.quietHours && quietNow(sys.now);
  const rows = (
    await sys.db
      .prepare(
        `SELECT t.* FROM ch_threads t WHERE t.member = ? AND ${NEEDS_ME} AND t.triage_status = 'done' AND t.waiting_since IS NOT NULL
         ORDER BY t.tier, t.waiting_since LIMIT 50`,
      )
      .bind(member, sys.now)
      .all<Row>()
  ).results;
  let sent = 0;
  for (const r of rows) {
    const tier = Number(r.tier) as Tier;
    const schedule = scheduleFor(tier, !!r.vip, r.reply_needed === 'maybe');
    const waited = sys.now - (r.waiting_since as number);
    const due = schedule.filter((h) => waited >= h * HOUR).length;
    const level = Number(r.nudge_level ?? 0);
    if (due <= level) continue;
    // Quiet hours hold everything except an urgent chat's first nudge.
    if (quiet && !(tier === 1 && level === 0)) continue;
    const title = `${LEVEL_TITLES[Math.min(due, 3) - 1]} ${r.title as string}`;
    const app = APP_LABELS[r.app as AppId] ?? 'Chat';
    const what = (r.summary as string) || `"${String(r.last_in_text ?? '').slice(0, 120)}"`;
    const seen =
      r.seen_at != null && (r.seen_at as number) >= Number(r.last_in_at ?? 0)
        ? ` You opened it on your phone at ${indiaTime(r.seen_at as number)}; if you replied there, mark it replied.`
        : '';
    await notify(
      sys.db,
      {
        recipient: member,
        module: 'chats',
        kind: 'chats.nudge',
        title: `${title} (${app})`,
        body: `${what.replace(/[.\s]+$/, '')}. Waiting ${waitLabel(waited)}.${seen}`,
        link: `chats/inbox#${r.id as string}`,
        dedupeKey: `chats.nudge:${r.id as string}:${r.waiting_since as number}:${due}`,
      },
      sys.now,
    );
    await sys.db
      .prepare('UPDATE ch_threads SET nudge_level = ? WHERE member = ? AND id = ? AND waiting_since = ?')
      .bind(due, member, r.id, r.waiting_since)
      .run();
    sent++;
  }
  return sent;
}
