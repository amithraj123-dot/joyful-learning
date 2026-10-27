// Small helpers for the Agents pages: errors, India time, trigger wording and labels.
import { ModuleError } from '../../../core/client/api';
import {
  EVENT_KINDS,
  EVENT_LABELS,
  REPEAT_LABELS,
  type Lesson,
  type LessonSource,
  type RunStatus,
  type RunTrigger,
  type Trigger,
} from '../shared/types';

export const errorStatus = (e: unknown) => (e instanceof ModuleError ? e.status : 0);
export function errorMessage(e: unknown) {
  if (e instanceof ModuleError && e.status === 404 && /unknown workspace action/i.test(e.message))
    return 'Agents are not available yet. Try again a little later.';
  return e instanceof Error && e.message ? e.message : 'Something went wrong. Try again.';
}
export const isConflict = (e: unknown) => errorStatus(e) === 409;

// Limits the inputs keep to (the server checks the same ones).
export const MAX = {
  command: 4000,
  name: 80,
  instruction: 4000,
  contains: 100,
  lesson: 300,
  comment: 1000,
  reason: 500,
  description: 400,
};

// India time. datetime-local values ("YYYY-MM-DDTHH:MM") are read as India time whatever the
// browser's own zone is.
const TZ = 'Asia/Kolkata';
const IST_OFFSET = 330 * 60000;
const DAY = 86400000;
export const toIstInput = (ms: number) => new Date(ms + IST_OFFSET).toISOString().slice(0, 16);
export function fromIstInput(text: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(text);
  if (!m) return NaN;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  return Date.UTC(y, mo - 1, d, h, mi) - IST_OFFSET;
}
const istDate = (ms: number) => toIstInput(ms).slice(0, 10);
const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
const dayMonth = (ms: number, now: number) =>
  new Date(ms).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(istDate(ms).slice(0, 4) !== istDate(now).slice(0, 4) ? { year: 'numeric' } : {}),
    timeZone: TZ,
  });

// "Today, 6:00 pm", "Tomorrow, 9:00 am", "Yesterday, 4:05 pm" or "28 Oct, 9:00 am".
export function atLabel(ms: number, now = Date.now()) {
  const d = istDate(ms);
  const day =
    d === istDate(now)
      ? 'Today'
      : d === istDate(now + DAY)
        ? 'Tomorrow'
        : d === istDate(now - DAY)
          ? 'Yesterday'
          : dayMonth(ms, now);
  return `${day}, ${clock(ms)}`;
}

// The next 9:00 am India time (the default first run of a new schedule).
export function nextNineAm(now = Date.now()) {
  const today = fromIstInput(istDate(now) + 'T09:00');
  return today > now ? today : today + DAY;
}

const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return n + s;
};
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
// "a, b or c"
export const orList = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;

// A trigger in words: "On command", "Every weekday at 6:00 pm", "Once on 28 Oct at 9:00 am",
// "When an urgent email arrives or a chat needs my reply, containing "Kestrel"".
export function triggerLabel(t: Trigger, now = Date.now()) {
  if (t.type === 'manual') return 'On command';
  if (t.type === 'schedule') {
    const at = clock(t.at);
    if (t.repeat === 'once') return `Once on ${dayMonth(t.at, now)} at ${at}`;
    if (t.repeat === 'weekly')
      return `Every ${new Date(t.at).toLocaleDateString('en-IN', { weekday: 'long', timeZone: TZ })} at ${at}`;
    if (t.repeat === 'monthly')
      return `Every month on the ${ordinal(Number(istDate(t.at).slice(8)))} at ${at}`;
    return `${REPEAT_LABELS[t.repeat]} at ${at}`;
  }
  // Kinds in the contract's order, so the wording is stable.
  const kinds = EVENT_KINDS.filter((k) => t.kinds.includes(k)).map((k) => lowerFirst(EVENT_LABELS[k]));
  const when = kinds.length ? `When ${orList(kinds)}` : 'When something happens';
  return t.contains.trim() ? `${when}, containing "${t.contains.trim()}"` : when;
}

// Why a trigger cannot be saved yet, or ''.
export function triggerProblem(t: Trigger, now = Date.now()) {
  if (t.type === 'schedule') {
    if (!Number.isFinite(t.at)) return 'Choose a date and time for the first run.';
    if (t.repeat === 'once' && t.at <= now) return 'That time has passed. Choose a later one.';
  }
  if (t.type === 'event' && !t.kinds.length) return 'Choose at least one thing that starts it.';
  return '';
}

export const sameTrigger = (a: Trigger, b: Trigger) => JSON.stringify(a) === JSON.stringify(b);

export const SOURCE_LABELS: Record<LessonSource, string> = {
  agent: 'Noted by the agent',
  feedback: 'From your rating',
  approval: 'From a decision',
  review: 'From a failed step',
  member: 'Added by you',
};
export const RUN_TRIGGER_LABELS: Record<RunTrigger, string> = {
  command: 'Command',
  manual: 'Run by you',
  schedule: 'On schedule',
  event: 'When something happened',
};
export const RUN_STATUS: Record<RunStatus, { label: string; tone: 'blue' | 'green' | 'red' }> = {
  running: { label: 'Running', tone: 'blue' },
  done: { label: 'Done', tone: 'green' },
  failed: { label: 'Failed', tone: 'red' },
};

export const firstLine = (s: string) => s.split('\n').find((l) => l.trim()) ?? '';
export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

// " Aeka learnt: ..." for a notice, or ''. Kept short: the lessons are listed in Memory and Learning.
export function learnt(lessons: Lesson[]) {
  if (!lessons.length) return '';
  const text = lessons
    .slice(0, 2)
    .map((l) => clip(l.text, 140))
    .join(' ');
  return ` Aeka learnt: ${text}${lessons.length > 2 ? ` (and ${plural(lessons.length - 2, 'more lesson')})` : ''}`;
}
