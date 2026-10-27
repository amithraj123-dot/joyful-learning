// Background work for one member, bounded per run: due reminders, meeting alerts, the morning brief,
// follow-up and overdue alerts, WhatsApp answers and deliveries. Safe to run twice at once: every step is guarded or idempotent.
import type { SystemContext } from '../../../core/server/env.ts';
import type { Member } from '../../../core/server/members.ts';
import { notify, takeLease } from '../../../core/server/notifications.ts';
import { followUps } from '../../mail/server/service.ts';
import type { Repeat } from '../shared/types.ts';
import { attempt, buildBrief, briefSummary } from './brief.ts';
import { meetingAlerts } from './calendar.ts';
import { memberContext } from './context.ts';
import { dueSoon } from './services.ts';
import { CRITICAL_AFTER } from './records.ts';
import { MINUTE, advance, dayLabel, istDate, istDayStart, whenLabel } from './recurrence.ts';
import { ensureSettingsRow, readSettings, whatsappReady } from './settings.ts';
import { processInbound, pruneEvents, queueNotices, sendOutbox } from './whatsapp.ts';

const REMINDER_BATCH = 50;
const LATE = 15 * MINUTE;

// Each due reminder gives one notice per occurrence (the dedupe key holds the occurrence time), then
// moves to its next future occurrence or is marked done. After downtime only one catch-up notice is
// sent; missed occurrences in between are skipped.
export async function fireReminders(sys: SystemContext, member: Member) {
  const { db, now } = sys;
  const due = (
    await db
      .prepare(
        "SELECT * FROM as_reminders WHERE member = ? AND status = 'active' AND due_at <= ? ORDER BY due_at LIMIT ?",
      )
      .bind(member.email, now, REMINDER_BATCH)
      .all<{
        id: string;
        title: string;
        due_at: number;
        repeat: Repeat;
        last_fired_at: number | null;
        revision: number;
      }>()
  ).results;
  let fired = 0;
  for (const r of due) {
    const { last, next } = advance(r.due_at, r.repeat, now, r.last_fired_at);
    const late = now - r.due_at > LATE;
    const parts = [
      late
        ? `This was due ${whenLabel(r.due_at)}. It is shown late because background work was paused${
            last > r.due_at ? ', and later occurrences were skipped' : ''
          }.`
        : `Due ${whenLabel(r.due_at)}.`,
      next ? `Next: ${whenLabel(next)}.` : '',
    ];
    const id = await notify(
      db,
      {
        recipient: member.email,
        module: 'assistant',
        kind: 'reminder',
        title: r.title,
        body: parts.filter(Boolean).join(' '),
        link: `assistant/todos#${r.id}`,
        dedupeKey: `reminder:${r.id}:${r.due_at}`,
      },
      now,
    );
    // Guarded: only the run that still sees this occurrence moves the reminder on.
    await db
      .prepare(
        "UPDATE as_reminders SET due_at = ?, status = ?, last_fired_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND member = ? AND status = 'active' AND due_at = ? AND revision = ?",
      )
      .bind(next ?? r.due_at, next ? 'active' : 'done', last, now, r.id, member.email, r.due_at, r.revision)
      .run();
    if (id) fired++;
  }
  return fired;
}

// Posts the morning brief once a day, at or after the member's brief time (India time).
export async function morningBrief(sys: SystemContext, member: Member) {
  const { db, now } = sys;
  const row = await readSettings(db, member.email);
  const today = istDate(now);
  if (!row.settings.briefEnabled || row.lastBriefDate === today) return false;
  const [h, m] = row.settings.briefTime.split(':').map(Number);
  if (now < istDayStart(now) + (h * 60 + m) * MINUTE) return false;
  const brief = await buildBrief(memberContext(sys, member));
  await notify(
    db,
    {
      recipient: member.email,
      module: 'assistant',
      kind: 'brief',
      title: `Your brief for ${dayLabel(now)}`,
      body: briefSummary(brief),
      link: 'assistant/today',
      dedupeKey: `brief:${today}`,
    },
    now,
  );
  const r = await db.batch([
    ensureSettingsRow(db, member.email, now),
    db
      .prepare(
        'UPDATE as_settings SET last_brief_date = ?, updated_at = ? WHERE member = ? AND (last_brief_date IS NULL OR last_brief_date != ?)',
      )
      .bind(today, now, member.email, today),
  ]);
  return r[1].meta.changes > 0;
}

const ALERT_EVERY = 30 * MINUTE;
const ALERT_BATCH = 20;

// In-app notices (not sent to WhatsApp this round): a waiting thread reaching level 3 (10 days without
// a reply), once per conversation and level; and a to-do becoming 3 days overdue, once per to-do.
// Checked at most every 30 minutes per member.
export async function followUpAlerts(sys: SystemContext, member: Member) {
  const { db, now } = sys;
  if (!(await takeLease(db, `assistant.alerts:${member.email}`, now, ALERT_EVERY))) return 0;
  let sent = 0;
  const ctx = memberContext(sys, member);
  const waiting = (await attempt(() => followUps(ctx, 'waiting', 50))) ?? [];
  for (const f of waiting.filter((x) => x.level === 3).slice(0, ALERT_BATCH)) {
    const id = await notify(
      db,
      {
        recipient: member.email,
        module: 'assistant',
        kind: 'followup',
        title: `No reply for ${f.ageDays} days: ${f.subject || '(no subject)'}`,
        body: `You wrote to ${f.counterpart.name || f.counterpart.address} on ${dayLabel(f.since)}${
          f.count > 1 ? ` (${f.count} emails)` : ''
        } and have had no answer.${f.matterLabel ? ` ${f.matterLabel}.` : ''} Draft a follow-up from Follow-ups.`,
        link: 'mail/followups',
        dedupeKey: `followup:${f.conversationId}:${f.level}`,
      },
      now,
    );
    if (id) sent++;
  }
  const critical = (
    await db
      .prepare(
        "SELECT id, title, due_at FROM as_todos WHERE member = ? AND status IN ('open','doing') AND due_at IS NOT NULL AND due_at <= ? AND (task_id IS NULL OR task_id NOT LIKE 'dismissed:%') ORDER BY due_at LIMIT ?",
      )
      .bind(member.email, now - CRITICAL_AFTER, ALERT_BATCH)
      .all<{ id: string; title: string; due_at: number }>()
  ).results;
  for (const t of critical) {
    const id = await notify(
      db,
      {
        recipient: member.email,
        module: 'assistant',
        kind: 'todo.critical',
        title: `Overdue since ${dayLabel(t.due_at)}: ${t.title}`,
        body: `This to-do was due ${whenLabel(t.due_at)}. Complete it, give it a new date or delete it.`,
        link: `assistant/todos#${t.id}`,
        dedupeKey: `todo.critical:${t.id}`,
      },
      now,
    );
    if (id) sent++;
  }
  return sent;
}

// A notice when an open to-do falls due (once per due time), on the workspace and the phone. Due times
// up to 6 hours past are caught up after downtime; older ones are left to the overdue alert.
export async function todoDueAlerts(sys: SystemContext, member: Member) {
  const due = await dueSoon(sys.db, member.email, sys.now - 6 * 60 * MINUTE, sys.now, {
    todos: true,
    reminders: false,
  });
  let sent = 0;
  for (const t of due) {
    const id = await notify(
      sys.db,
      {
        recipient: member.email,
        module: 'assistant',
        kind: 'todo.due',
        title: t.title,
        body: t.body,
        link: t.link,
        dedupeKey: t.key,
      },
      sys.now,
    );
    if (id) sent++;
  }
  return sent;
}

export async function assistantTick(sys: SystemContext, scope: { member?: Member }) {
  const member = scope.member;
  if (!member?.active) return;
  await fireReminders(sys, member);
  await todoDueAlerts(sys, member);
  await meetingAlerts(sys, member);
  await morningBrief(sys, member);
  await followUpAlerts(sys, member);
  if (whatsappReady(sys.env)) {
    for (let i = 0; i < 2; i++) if (!(await processInbound(sys, member))) break;
    await queueNotices(sys, await readSettings(sys.db, member.email));
    await sendOutbox(sys, member.email);
  }
  await pruneEvents(sys.db, sys.now);
}
