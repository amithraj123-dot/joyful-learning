// Quick add: one line of plain words becomes a to-do, without AI. India time throughout.
//   "Send Rahul the valuation note tomorrow 4pm #Falcon !"  due tomorrow 4:00 pm, list Falcon, high
//   "File Form 15CA on 3 Nov"                                 due 3 Nov at 6:00 pm (a date alone means EOD)
//   "Remind me at 6 pm to call the bank"                      due today 6:00 pm (tomorrow if 6 pm has passed)
//   "Timesheet every Friday"                                  repeats every week, due this Friday 6:00 pm
// Times are read only with "at", am or pm, or a colon (16:30), so a number in a title ("Form 15CA",
// "Section 194") is never taken as a time. Anything not understood stays in the title.
import type { TodoPriority, TodoRepeat } from '../shared/types.ts';
import { DAY, HOUR, MINUTE, daysInMonth, istDayStart, istParts, longLabel } from './recurrence.ts';
import { bad } from './validate.ts';

export const EOD_MINUTES = 18 * 60;
export const QUICK_ADD_MAX = 500;

export interface QuickAdd {
  title: string;
  dueAt: number | null;
  list: string;
  priority: TodoPriority;
  repeat: TodoRepeat;
  understood: string; // one line, e.g. 'Read as "Call Rahul"; due Wednesday, 28 Oct 2026, 4:00 pm.'
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
// Monday is 0. "sat" and "sun" are read only in full, so "Sun Pharma" stays in the title.
const WEEKDAY =
  '(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:s|nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|saturday|sunday)';
const weekdayIndex = (w: string) => ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].indexOf(w.slice(0, 3));
// Optional words before a date or time, removed with it ("by Friday", "on 3 Nov", "due at 4").
const LEAD = '(?:\\b(?:by|on|before|due|this|coming|for)\\s+)?';
const REPEAT_WORDS: Record<string, TodoRepeat> = {
  day: 'daily',
  week: 'weekly',
  fortnight: 'fortnightly',
  'two weeks': 'fortnightly',
  '2 weeks': 'fortnightly',
  'other week': 'fortnightly',
  month: 'monthly',
};
const REPEAT_LABELS: Record<TodoRepeat, string> = {
  none: '',
  daily: 'every day',
  weekly: 'every week',
  fortnightly: 'every two weeks',
  monthly: 'every month',
};

// India calendar day (midnight) for a year, month (0 to 11) and day, or null when it does not exist.
function dayOf(year: number, month: number, day: number) {
  if (month < 0 || month > 11 || day < 1 || day > daysInMonth(year, month)) return null;
  return Date.UTC(year, month, day) - 330 * MINUTE;
}

export function parseQuickAdd(input: string, now: number): QuickAdd {
  let s = ` ${input.replace(/\s+/g, ' ').trim()} `;
  const today = istDayStart(now);
  const p = istParts(now);
  const mondayIndex = (p.weekday + 6) % 7;
  let day: number | null = null; // India midnight of the due day
  let minutes: number | null = null; // time of day
  let absolute: number | null = null; // "in 3 hours"
  let repeat: TodoRepeat = 'none';
  let priority: TodoPriority = 'normal';
  let list = '';
  let tonight = false;
  let wasReminder = false;

  // Removes the first match and returns it.
  const take = (re: RegExp) => {
    const m = s.match(re);
    if (m) s = s.slice(0, m.index) + ' ' + s.slice(m.index! + m[0].length);
    return m;
  };

  if (take(/^\s*(?:please\s+)?(?:remind me|reminder:?|to-?do:?)(?=\s)/i)) wasReminder = true;

  // #List: the first tag is the list; any others are dropped from the title.
  for (
    let m = take(/\s#([A-Za-z][\w&.-]{0,39})(?=[\s,.;!?]|$)/);
    m;
    m = take(/\s#([A-Za-z][\w&.-]{0,39})(?=[\s,.;!?]|$)/)
  )
    if (!list) list = m[1].replace(/_/g, ' ');

  // "!" on its own or at the end of a word, or "high priority": high priority.
  if (take(/\s!+(?=\s)/) || take(/(?<=\w)!+(?=\s)/) || take(/[\s,]+high priority\b/i)) priority = 'high';
  for (let i = 0; i < 5 && (take(/\s!+(?=\s)/) || take(/(?<=\w)!+(?=\s)/)); i++) priority = 'high';

  // Repeats: "every Friday" also gives the day.
  let m = take(new RegExp(`\\bevery\\s+${WEEKDAY}\\b`, 'i'));
  if (m) {
    repeat = 'weekly';
    const w = weekdayIndex(m[1].toLowerCase());
    day = today + ((w - mondayIndex + 7) % 7) * DAY;
  } else {
    // Only "every ...": "Weekly digest review" is a title, not a repeat.
    m = take(/\bevery\s+(day|week|fortnight|month|two weeks|2 weeks|other week)\b/i);
    if (m) repeat = REPEAT_WORDS[m[1].toLowerCase()];
  }

  // Dates.
  const year = (y: string | undefined) => (y ? (y.length === 2 ? 2000 + Number(y) : Number(y)) : null);
  const explicit = (y: number | null, month: number, d: number) => {
    if (y != null) return dayOf(y, month, d);
    const same = dayOf(p.year, month, d);
    if (same != null && same >= today) return same;
    return dayOf(p.year + 1, month, d); // a date already past this year means next year
  };
  if (day == null && (m = take(new RegExp(`${LEAD}\\bday after (?:tomorrow|tmrw)\\b`, 'i'))))
    day = today + 2 * DAY;
  if (day == null && (m = take(new RegExp(`${LEAD}\\b(?:tomorrow|tomorow|tmrw|tmr)\\b`, 'i'))))
    day = today + DAY;
  if (day == null && (m = take(new RegExp(`${LEAD}\\b(today|tonight)\\b`, 'i')))) {
    day = today;
    tonight = m[1].toLowerCase() === 'tonight';
  }
  if (day == null && (m = take(new RegExp(`${LEAD}\\bnext week\\b`, 'i'))))
    day = today + (7 - mondayIndex) * DAY;
  if (day == null && (m = take(/\bin (\d{1,3}) (day|days|week|weeks)\b/i)))
    day = today + Number(m[1]) * (m[2].startsWith('week') ? 7 : 1) * DAY;
  if (day == null && (m = take(/\bin (\d{1,2}) (hour|hours|hr|hrs|minutes|mins)\b/i)))
    absolute = now + Number(m[1]) * (m[2].startsWith('h') ? HOUR : MINUTE);
  if (day == null && absolute == null) {
    m = take(new RegExp(`${LEAD}\\b(next\\s+)?${WEEKDAY}\\b`, 'i'));
    if (m) {
      const w = weekdayIndex(m[2].toLowerCase());
      // "Friday": the coming Friday (a week today if today is Friday); "next Friday": Friday next week.
      day = m[1] ? today + (7 - mondayIndex + w) * DAY : today + ((w - mondayIndex + 7) % 7 || 7) * DAY;
    }
  }
  if (day == null && absolute == null) {
    m = take(new RegExp(`${LEAD}\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH}\\b(?:,?\\s+(\\d{4}))?`, 'i'));
    if (m) day = explicit(year(m[3]), MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()), Number(m[1]));
    else {
      m = take(new RegExp(`${LEAD}\\b${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, 'i'));
      if (m) day = explicit(year(m[3]), MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()), Number(m[2]));
    }
  }
  if (
    day == null &&
    absolute == null &&
    (m = take(new RegExp(`${LEAD}\\b(\\d{4})-(\\d{2})-(\\d{2})\\b`, 'i')))
  )
    day = dayOf(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  // Day first, as in India: 3/11 is 3 November.
  if (day == null && absolute == null) {
    const re = new RegExp(`${LEAD}(?<![\\w/])(\\d{1,2})/(\\d{1,2})(?:/(\\d{4}|\\d{2}))?(?![\\w/])`, 'i');
    const found = s.match(re);
    if (found) {
      const d = explicit(year(found[3]), Number(found[2]) - 1, Number(found[1]));
      if (d != null) {
        take(re);
        day = d;
      }
    }
  }

  // Times.
  if (absolute == null) {
    if (take(/(?:\b(?:by|at|before)\s+)?\b(?:eod|end of (?:the )?day|cob|close of business)\b/i))
      minutes = EOD_MINUTES;
    else if (take(/(?:\b(?:by|at|before)\s+)?\b(?:noon|midday)\b/i)) minutes = 12 * 60;
    else if (
      (m = take(
        /(?:\b(?:by|at|before)\s+)?\b(1[0-2]|0?[1-9])(?:[:.]([0-5]\d))?\s*(am|pm|a\.m\.|p\.m\.)(?=[\s,.;!?]|$)/i,
      ))
    ) {
      const pm = m[3].toLowerCase().startsWith('p');
      minutes = ((Number(m[1]) % 12) + (pm ? 12 : 0)) * 60 + Number(m[2] ?? 0);
    } else if ((m = take(/(?:\b(?:by|at|before)\s+)?(?<![\w/:.])([01]?\d|2[0-3]):([0-5]\d)(?![\w:])/i)))
      minutes = Number(m[1]) * 60 + Number(m[2]);
    else if ((m = take(/\b(?:by|at|before)\s+([01]?\d|2[0-3])(?![\w:./%])/i))) {
      // A bare hour after "at" is read in working hours: 1 to 7 is afternoon, 8 to 11 morning.
      const h = Number(m[1]);
      minutes = (h >= 1 && h <= 7 ? h + 12 : h) * 60;
    }
  }
  if (minutes == null && tonight) minutes = 20 * 60;

  let dueAt: number | null = absolute;
  if (dueAt == null) {
    if (day != null) {
      dueAt = day + (minutes ?? EOD_MINUTES) * MINUTE;
      // "every Friday" said on a Friday evening starts next Friday.
      if (repeat !== 'none' && dueAt <= now) dueAt += 7 * DAY;
    } else if (minutes != null) {
      dueAt = today + minutes * MINUTE;
      if (dueAt <= now) dueAt += DAY;
    } else if (repeat !== 'none') {
      // A repeating to-do needs a date: today at the end of the day, or tomorrow if that has passed.
      dueAt = today + EOD_MINUTES * MINUTE;
      if (dueAt <= now) dueAt += DAY;
    }
  }

  // What is left is the title, without the joining words the dates and times left behind.
  const leading = wasReminder
    ? /^(?:to|that|about|on|at|by|due|before)\b\s*/i
    : /^(?:on|at|by|due|before)\b\s*/i;
  const trailing = /\s*\b(?:to|on|at|by|due|before|for|and|this|coming|next|from)$/i;
  let title = s.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 4; i++) {
    const before = title;
    title = title
      .replace(/^[\s,;:.\-–—]+|[\s,;:\-–—]+$/g, '')
      .replace(leading, '')
      .replace(trailing, '')
      .trim();
    if (title === before) break;
  }
  if (!title)
    throw bad('Say what the to-do is, for example "Send Rahul the valuation note tomorrow 4pm #Falcon".');
  title = title.charAt(0).toUpperCase() + title.slice(1);
  if (title.length > 240) title = title.slice(0, 240).trim();

  const parts = [`Read as "${title}"`, dueAt == null ? 'no due date' : `due ${longLabel(dueAt)}`];
  if (list) parts.push(`list ${list}`);
  if (priority === 'high') parts.push('high priority');
  if (repeat !== 'none') parts.push(`repeats ${REPEAT_LABELS[repeat]}`);
  return { title, dueAt, list, priority, repeat, understood: parts.join('; ') + '.' };
}
