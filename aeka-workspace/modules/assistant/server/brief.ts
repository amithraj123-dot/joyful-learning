// The morning brief, assembled without AI from the calendar, mail triage, follow-ups, tasks, to-dos,
// reminders and deadlines, with a few counted observations (Patterns). Sections with nothing in them
// are left out; the short sections show at most 5 lines.
import type { ModuleContext } from '../../../core/server/module.ts';
import { chatsNeedingMe } from '../../chats/server/service.ts';
import { followUps, mailConnected, mailCounts, mailQueue } from '../../mail/server/service.ts';
import type { FollowUp } from '../../mail/shared/types.ts';
import { myOpenTasks, upcomingDeadlines } from '../../workflow/server/services.ts';
import type { Brief, BriefLine, DayHealth } from '../shared/types.ts';
import { calendarSection } from './calendar.ts';
import { todayHealth } from './meetings.ts';
import { listReminders, listTodos } from './records.ts';
import { DAY, calendarLabel, dayLabel, istDate, istDayStart, istParts, timeLabel } from './recurrence.ts';

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

const SHORT = 5;
const shortList = (lines: BriefLine[], link: string) =>
  lines.length > SHORT
    ? [...lines.slice(0, SHORT - 1), { text: `and ${lines.length - (SHORT - 1)} more`, link }]
    : lines;
const who = (f: FollowUp) => f.counterpart.name || f.counterpart.address;
const days = (n: number) => plural(n, 'day');

// Waiting on others and people chasing me, most pressing first (chasing before waiting).
export function followUpLines(items: FollowUp[]): BriefLine[] {
  const chasing = items.filter((f) => f.kind === 'chasing');
  const waiting = items.filter((f) => f.kind === 'waiting');
  const lines: BriefLine[] = [
    ...chasing.map((f) => ({
      text: `${who(f)} is waiting for your reply on "${f.subject || '(no subject)'}" (${plural(f.count, 'message')}, ${days(f.ageDays)})`,
      link: `mail/inbox#${f.mailId}`,
    })),
    ...waiting.map((f) => ({
      text: `You are waiting on ${who(f)} for "${f.subject || '(no subject)'}" (${days(f.ageDays)}${f.count > 1 ? `, ${plural(f.count, 'email')} unanswered` : ''})`,
      link: 'mail/followups',
    })),
  ];
  return lines.map((l) => ({ ...l, text: l.text.slice(0, 220) }));
}

// Deterministic observations about the day and the inbox. Each says what it counted.
export function patternLines(input: {
  followUps: FollowUp[];
  health: DayHealth | null;
  commitmentsDue: number;
}): BriefLine[] {
  const lines: BriefLine[] = [];
  const chasing = input.followUps.filter((f) => f.kind === 'chasing');
  const waitingOnMe = new Set(chasing.filter((f) => f.ageDays >= 2).map((f) => f.counterpart.address));
  if (waitingOnMe.size)
    lines.push({
      text: `${plural(waitingOnMe.size, 'person', 'people')} ${waitingOnMe.size === 1 ? 'has' : 'have'} been waiting on you for more than 2 days.`,
      link: 'mail/followups',
    });
  const h = input.health;
  if (h && h.meetings)
    lines.push({
      text: `You have ${hours(h.meetingMinutes)} of meetings and ${hours(h.focusMinutes)} of focus time today${
        h.clashes ? `, with ${plural(h.clashes, 'clash', 'clashes')}` : ''
      }.`,
      link: 'assistant/today',
    });
  for (const f of chasing.filter((x) => x.count >= 3).slice(0, 2))
    lines.push({
      text: `${who(f)} has followed up ${f.count} times on "${f.subject || '(no subject)'}".`,
      link: `mail/inbox#${f.mailId}`,
    });
  const stuck = input.followUps.filter((f) => f.kind === 'waiting' && f.level === 3).length;
  if (stuck)
    lines.push({
      text: `${plural(stuck, 'email')} you sent ${stuck === 1 ? 'has' : 'have'} had no reply for 10 days or more.`,
      link: 'mail/followups',
    });
  if (input.commitmentsDue)
    lines.push({
      text: `${plural(input.commitmentsDue, 'commitment')} you made in email ${input.commitmentsDue === 1 ? 'is' : 'are'} due by the end of this week.`,
      link: 'assistant/todos',
    });
  return lines.slice(0, SHORT);
}

// "2 hours", "1.5 hours", "45 minutes"
function hours(minutes: number) {
  if (minutes < 60) return plural(minutes, 'minute');
  const h = Math.round((minutes / 60) * 2) / 2;
  return `${h} ${h === 1 ? 'hour' : 'hours'}`;
}

// `fresh` refreshes the calendar first when it is older than a few minutes (when a member opens the
// brief); background runs use the calendar Mail refreshed moments before.
export async function buildBrief(ctx: ModuleContext, fresh = false): Promise<Brief> {
  const now = ctx.now;
  const today = istDate(now);
  const startOfToday = istDayStart(now);
  const endOfToday = startOfToday + DAY;
  const sections: Brief['sections'] = [];
  const todos = await listTodos(ctx);

  // Critical to-dos (3 or more days overdue) lead the brief.
  const critical = todos.filter((t) => t.critical);
  if (critical.length)
    sections.push({
      title: 'Overdue 3 days or more',
      lines: shortList(
        critical.map((t) => ({
          text: `${t.title} (due ${dayLabel(t.dueAt!)}${t.priority === 'high' ? ', high priority' : ''})`,
          link: `assistant/todos#${t.id}`,
        })),
        'assistant/todos',
      ),
    });

  const meetings = await calendarSection(ctx, fresh);
  const health = meetings.length ? await todayHealth(ctx) : null;
  if (meetings.length) {
    if (health && health.meetings)
      meetings.unshift({
        text: `Day health: ${health.label} (${health.score} of 100).`,
        link: 'assistant/today',
      });
    sections.push({ title: 'Your calendar today', lines: meetings });
  }

  const mail = await mailSection(ctx);
  if (mail.length) sections.push({ title: 'Needs you in mail', lines: mail });

  // Chats read from the phone (WhatsApp and others) waiting for my reply, longest wait first by tier.
  const chats = await attempt(() => chatsNeedingMe(ctx, MAX_LINES));
  if (chats?.total)
    sections.push({
      title: 'Chats waiting for your reply',
      lines: [
        ...chats.chats.slice(0, chats.total > MAX_LINES ? MAX_LINES - 1 : MAX_LINES).map((c) => ({
          text: `${c.title} (${c.app}${c.waitingFor ? `, ${c.waitingFor}` : ''})${c.summary ? `: ${c.summary}` : ''}`,
          link: c.link,
        })),
        ...(chats.total > MAX_LINES
          ? [{ text: `and ${chats.total - (MAX_LINES - 1)} more`, link: 'chats/inbox' }]
          : []),
      ],
    });

  const follow = (await attempt(() => followUps(ctx, undefined, 30))) ?? [];
  const followLines = followUpLines(follow);
  if (followLines.length)
    sections.push({ title: 'Waiting and chasing', lines: shortList(followLines, 'mail/followups') });

  const due: BriefLine[] = [];
  for (const t of todos) {
    if (t.critical || t.dueAt == null || t.dueAt >= endOfToday) continue;
    const when =
      t.dueAt < startOfToday ? `overdue since ${dayLabel(t.dueAt)}` : `today ${timeLabel(t.dueAt)}`;
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

  const stale = todos.filter((t) => t.stale);
  if (stale.length)
    sections.push({
      title: 'Open for more than a week without a date',
      lines: shortList(
        stale.map((t) => ({
          text: `${t.title} (added ${dayLabel(t.createdAt)})`,
          link: `assistant/todos#${t.id}`,
        })),
        'assistant/todos',
      ),
    });

  // The end of this week: Sunday night, India time.
  const weekEnd = startOfToday + (7 - ((istParts(now).weekday + 6) % 7)) * DAY;
  const patterns = patternLines({
    followUps: follow,
    health,
    commitmentsDue: todos.filter((t) => t.source === 'commitment' && t.dueAt != null && t.dueAt < weekEnd)
      .length,
  });
  if (patterns.length) sections.push({ title: 'Patterns', lines: patterns });

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
