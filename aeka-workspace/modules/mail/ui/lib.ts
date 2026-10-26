// Small browser helpers for the Mail pages: India-time formatting, errors, tones and safe text.
import { ModuleError } from '../../../core/client/api';
import { TIER_LABELS, type Address, type DraftStatus, type MailItem, type Tier } from '../shared/types';

export type Nav = (page: string) => void;

// Firm member as returned by core members.list.
export interface Member {
  email: string;
  name: string;
  initials: string;
  designation: string;
  isAdmin: boolean;
  active: boolean;
}
// A mandate the member can see, from workflow meetings.targets.
export interface Target {
  matterId: string;
  title: string;
  clientName: string;
  status: string;
  restricted: boolean;
}

export const errorStatus = (e: unknown) => (e instanceof ModuleError ? e.status : 0);
export function errorMessage(e: unknown) {
  const status = errorStatus(e);
  if (status === 404 && e instanceof Error && /unknown workspace action/i.test(e.message))
    return 'Mail is not available on the server yet. Please try again later.';
  if (status === 409) return 'This was changed elsewhere. The latest version has been loaded.';
  return e instanceof Error && e.message ? e.message : 'The workspace request failed.';
}
export const isConflict = (e: unknown) => errorStatus(e) === 409;

const IST = 'Asia/Kolkata';
const dayKey = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: IST });
export const todayIST = () => dayKey(Date.now());

export const formatTime = (ms: number) =>
  new Date(ms).toLocaleTimeString('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit' });

// Received time for lists: time today, "Yesterday", day and month this year, full date otherwise.
export function formatReceived(ms: number) {
  const key = dayKey(ms);
  const today = todayIST();
  if (key === today) return formatTime(ms);
  if (key === addDays(today, -1)) return 'Yesterday';
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return new Date(ms).toLocaleDateString('en-IN', {
    timeZone: IST,
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

// "10:42 am" today, "Yesterday, 10:42 am" or "24 Oct, 10:42 am" otherwise.
export function formatWhen(ms: number) {
  const day = formatReceived(ms);
  const time = formatTime(ms);
  return day === time ? time : day + ', ' + time;
}

export const formatStamp = (ms: number) =>
  new Date(ms).toLocaleString('en-IN', {
    timeZone: IST,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

// Calendar dates (YYYY-MM-DD) are parsed as UTC so they never shift a day.
const utc = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
};
export const addDays = (d: string, n: number) => {
  const x = utc(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
export const formatDate = (d: string) =>
  utc(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const formatShortDate = (d: string) =>
  utc(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// Deadline badge text and tone: overdue and today in red, within two days amber, later grey.
export function deadlineBadge(deadline: string) {
  const today = todayIST();
  if (deadline < today) return { text: 'Overdue, ' + formatShortDate(deadline), tone: 'red' as const };
  if (deadline === today) return { text: 'Due today', tone: 'red' as const };
  if (deadline === addDays(today, 1)) return { text: 'Due tomorrow', tone: 'amber' as const };
  if (deadline <= addDays(today, 2)) return { text: 'Due ' + formatShortDate(deadline), tone: 'amber' as const };
  return { text: 'Due ' + formatShortDate(deadline), tone: 'grey' as const };
}

export const tierLabel = (t: Tier) => TIER_LABELS[t];

export const DRAFT_STATUS_LABELS: Record<DraftStatus, string> = {
  draft: 'Draft ready',
  saved: 'Saved in Outlook',
  sent: 'Sent',
  discarded: 'Discarded',
};

export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export const senderName = (a: Address) => a.name?.trim() || a.address;
export const addressLine = (list: Address[]) => list.map((a) => senderName(a)).join(', ');

const EMAIL = /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[a-z]{2,}$/i;
export const isEmail = (s: string) => EMAIL.test(s.trim());

export const isLow = (item: MailItem) =>
  !!item.triage && item.triage.status === 'done' && (item.triage.tier === 4 || item.triage.handling === 'none');

// Splits text into plain parts and http(s) links. Anything else stays as text, never as markup.
const URL_RE = /\bhttps?:\/\/[^\s<>"'()[\]{}]+/gi;
export function linkParts(text: string): { text: string; href?: string }[] {
  const out: { text: string; href?: string }[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0];
    // Leave trailing punctuation outside the link.
    const trail = /[.,;:!?]+$/.exec(url)?.[0] ?? '';
    if (trail) url = url.slice(0, -trail.length);
    const start = m.index ?? 0;
    let href: string | undefined;
    try {
      const u = new URL(url);
      if ((u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password) href = u.href;
    } catch {}
    if (start > last) out.push({ text: text.slice(last, start) });
    out.push(href ? { text: url, href } : { text: url });
    last = start + url.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

// Only Outlook on the web links are opened from the workspace.
export function safeWebLink(link: string) {
  try {
    const u = new URL(link);
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}
