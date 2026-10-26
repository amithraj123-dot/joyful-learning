// India time (UTC+5:30, no daylight saving) and reminder recurrence.
import type { Repeat } from '../shared/types.ts';

export const IST = 330 * 60000;
export const MINUTE = 60000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Calendar parts of an instant in India time.
export function istParts(ms: number) {
  const d = new Date(ms + IST);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}
export const istDate = (ms: number) => new Date(ms + IST).toISOString().slice(0, 10);
export const istDayStart = (ms: number) => {
  const p = istParts(ms);
  return Date.UTC(p.year, p.month, p.day) - IST;
};
export const istTimeOfDay = (ms: number) => (((ms + IST) % DAY) + DAY) % DAY;
export const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

const clock = (ms: number) => {
  const p = istParts(ms);
  const h = p.hour % 12 || 12;
  return `${h}:${String(p.minute).padStart(2, '0')} ${p.hour < 12 ? 'am' : 'pm'}`;
};
// "26 Oct"
export const dayLabel = (ms: number) => {
  const p = istParts(ms);
  return `${p.day} ${MONTHS[p.month]}`;
};
// "26 Oct 2026"
export const dateLabel = (ms: number) => `${dayLabel(ms)} ${istParts(ms).year}`;
// "26 Oct 2026, 3:00 pm"
export const whenLabel = (ms: number) => `${dateLabel(ms)}, ${clock(ms)}`;
export const timeLabel = clock;
// "Monday, 26 Oct 2026, 3:00 pm"
export const longLabel = (ms: number) => `${WEEKDAYS[istParts(ms).weekday]}, ${whenLabel(ms)}`;
// "2026-10-26T15:00:00+05:30"
export const isoIST = (ms: number) => new Date(ms + IST).toISOString().slice(0, 19) + '+05:30';
// A calendar date (YYYY-MM-DD) as "26 Oct 2026".
export const calendarLabel = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

// The day of the month a monthly reminder keeps to. A month shorter than that day moves the
// occurrence to its last day; the previous occurrence recovers the intended day afterwards (31 Jan,
// 28 Feb, then 31 Mar rather than 28 Mar).
function monthlyAnchor(dueAt: number, previous: number | null) {
  const p = istParts(dueAt);
  if (previous == null || p.day !== daysInMonth(p.year, p.month)) return p.day;
  const q = istParts(previous);
  const prevMonth = (p.month + 11) % 12;
  const prevYear = p.month === 0 ? p.year - 1 : p.year;
  const sameClock = istTimeOfDay(previous) === istTimeOfDay(dueAt);
  return q.year === prevYear && q.month === prevMonth && sameClock && q.day > p.day ? q.day : p.day;
}

// The occurrence after `dueAt`. `previous` is the occurrence before it, if known (monthly only).
export function nextOccurrence(dueAt: number, repeat: Repeat, previous: number | null = null): number | null {
  switch (repeat) {
    case 'once':
      return null;
    case 'daily':
      return dueAt + DAY;
    case 'weekly':
      return dueAt + 7 * DAY;
    case 'weekdays': {
      let t = dueAt + DAY;
      while ([0, 6].includes(istParts(t).weekday)) t += DAY;
      return t;
    }
    case 'monthly': {
      const p = istParts(dueAt);
      const anchor = monthlyAnchor(dueAt, previous);
      const year = p.month === 11 ? p.year + 1 : p.year;
      const month = (p.month + 1) % 12;
      const day = Math.min(anchor, daysInMonth(year, month));
      return Date.UTC(year, month, day) - IST + istTimeOfDay(dueAt);
    }
  }
}

// After an occurrence at `dueAt` fires at `now`: the latest occurrence at or before now (recorded as
// lastFiredAt) and the first one after now. Missed occurrences in between are skipped, never replayed.
export function advance(dueAt: number, repeat: Repeat, now: number, previous: number | null = null) {
  let last = dueAt;
  let prev = previous;
  if (repeat === 'once') return { last, next: null };
  // Fixed intervals jump straight to the last missed occurrence.
  const step = repeat === 'daily' ? DAY : repeat === 'weekly' ? 7 * DAY : repeat === 'weekdays' ? 7 * DAY : 0;
  if (step && now - last > step) {
    const k = Math.floor((now - last) / step) - (repeat === 'weekdays' ? 1 : 0);
    if (k > 0) {
      last += k * step;
      prev = null;
    }
  }
  let next = nextOccurrence(last, repeat, prev)!;
  for (let i = 0; next <= now && i < 5000; i++) {
    prev = last;
    last = next;
    next = nextOccurrence(last, repeat, prev)!;
  }
  return { last, next };
}
