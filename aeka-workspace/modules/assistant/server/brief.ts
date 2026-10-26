// The morning brief, assembled without AI from mail triage, tasks, to-dos, reminders and deadlines.
// Sections with nothing in them are left out.
import type { ModuleContext } from '../../../core/server/module.ts';
import { mailConnected, mailCounts, mailQueue } from '../../mail/server/service.ts';
import { myOpenTasks, upcomingDeadlines } from '../../workflow/server/services.ts';
import type { Brief, BriefLine } from '../shared/types.ts';
import { listReminders, listTodos } from './records.ts';
import { DAY, calendarLabel, dayLabel, istDate, istDayStart, timeLabel } from './recurrence.ts';

const MAX_LINES = 8;
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

// A call to another module's service that may fail (for example Mail before it is connected or while
// it is being built). Failures leave the section out rather than breaking the brief or the chat.
export async function attempt<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

const capped = (lines: BriefLine[], link: string) =>
  lines.length > MAX_LINES
    ? [...lines.slice(0, MAX_LINES - 1), { text: `and ${lines.length - (MAX_LINES - 1)} more`, link }]
    : lines;

export async function mailSection(ctx: ModuleContext): Promise<BriefLine[]> {
  if (!(await attempt(() => mailConnected(ctx)))) return [];
  const counts = await attempt(() => mailCounts(ctx));
  if (!counts) return [];
  const lines: BriefLine[] = [];
  const parts = [
    counts.urgent ? `${counts.urgent} urgent` : '',
    counts.needs_me ? `${counts.needs_me} need you` : '',
    counts.decisionsAwaiting ? `${plural(counts.decisionsAwaiting, 'reply decision')} waiting` : '',
    counts.draftsAwaiting ? `${plural(counts.draftsAwaiting, 'draft')} to review` : '',
  ].filter(Boolean);
  if (!parts.length) return [];
  lines.push({ text: 'Mail: ' + parts.join(', ') + '.', link: 'mail/inbox' });
  const items = (await attempt(() => mailQueue(ctx, 'needs_me', 5))) ?? [];
  for (const m of items.slice(0, 5)) {
    const urgent = m.triage?.tier === 1 ? 'Urgent: ' : '';
    const from = m.from.name || m.from.address;
    lines.push({
      text: `${urgent}${from}: ${m.subject || '(no subject)'}`.slice(0, 200),
      link: `mail/inbox#${m.id}`,
    });
  }
  if (counts.draftsAwaiting) lines.push({ text: 'Drafts waiting for your review', link: 'mail/drafts' });
  return lines;
}

export async function buildBrief(ctx: ModuleContext): Promise<Brief> {
  const now = ctx.now;
  const today = istDate(now);
  const endOfToday = istDayStart(now) + DAY;
  const sections: Brief['sections'] = [];

  const mail = await mailSection(ctx);
  if (mail.length) sections.push({ title: 'Needs you in mail', lines: mail });

  const due: BriefLine[] = [];
  for (const t of await listTodos(ctx)) {
    if (t.dueAt == null || t.dueAt >= endOfToday) continue;
    const when =
      t.dueAt < istDayStart(now) ? `overdue since ${dayLabel(t.dueAt)}` : `today ${timeLabel(t.dueAt)}`;
    due.push({ text: `${t.title} (${when})`, link: `assistant/todos#${t.id}` });
  }
  const tasks = (await attempt(() => myOpenTasks(ctx))) ?? [];
  for (const t of tasks) {
    if (!t.dueDate || t.dueDate > today) continue;
    const when = t.dueDate < today ? `overdue since ${calendarLabel(t.dueDate).slice(0, -5)}` : 'due today';
    due.push({ text: `${t.title}, ${t.matterLabel} (${when})`, link: 'workflow/tasks' });
  }
  if (due.length) sections.push({ title: 'Due today and overdue', lines: capped(due, 'assistant/todos') });

  const until = istDate(now + 7 * DAY);
  const deadlines = ((await attempt(() => upcomingDeadlines(ctx, until))) ?? []).filter(
    (d) => d.dueDate >= today,
  );
  if (deadlines.length)
    sections.push({
      title: 'Deadlines in the next 7 days',
      lines: capped(
        deadlines.map((d) => ({
          text: `${calendarLabel(d.dueDate).slice(0, -5)}: ${d.title}, ${d.matterLabel}`,
          link: 'workflow/calendar',
        })),
        'workflow/calendar',
      ),
    });

  const reminders = (await listReminders(ctx)).filter(
    (r) => r.status === 'active' && r.dueAt >= istDayStart(now) && r.dueAt < endOfToday,
  );
  if (reminders.length)
    sections.push({
      title: 'Reminders today',
      lines: capped(
        reminders.map((r) => ({
          text: `${timeLabel(r.dueAt)}: ${r.title}`,
          link: `assistant/todos#${r.id}`,
        })),
        'assistant/todos',
      ),
    });

  return { date: today, generatedAt: now, sections };
}

// A few lines for the brief notification (and WhatsApp).
export function briefSummary(brief: Brief) {
  if (!brief.sections.length)
    return 'Nothing is due today, and there is no urgent mail or deadline this week.';
  const lines: string[] = [];
  for (const s of brief.sections) {
    const more = s.lines.at(-1)?.text.match(/^and (\d+) more$/);
    const items = more ? s.lines.slice(0, -1) : s.lines;
    const total = items.length + (more ? Number(more[1]) : 0);
    lines.push(s.title + ':');
    for (const l of items.slice(0, 3)) lines.push('- ' + l.text);
    if (total > 3) lines.push(`- and ${total - 3} more`);
  }
  return lines.join('\n').slice(0, 1500);
}
