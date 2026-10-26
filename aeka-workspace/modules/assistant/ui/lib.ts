// Browser helpers for the Assistant pages: India time, errors, core types and page links.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ModuleError, callModule } from '../../../core/client/api';
import { findPage } from '../../../core/client/registry';

export const IST_OFFSET = 330 * 60000;
const TZ = 'Asia/Kolkata';

// Core records used by these pages (mirrors core/server).
export interface Member {
  email: string;
  name: string;
  initials: string;
  designation: string;
  isAdmin: boolean;
  active: boolean;
}
export interface MeInfo {
  email: string;
  member: Member | null;
}
export interface Notice {
  id: string;
  module: string;
  kind: string;
  title: string;
  body: string;
  link: string;
  createdAt: number;
  readAt: number | null;
}
export interface IntegrationsStatus {
  ai: { ready: boolean; reason: string; model?: string; fastModel?: string };
  aiDailyLimit: number;
  secureStorage: boolean;
  outlook: boolean;
  publicOrigin: string;
  scheduler: boolean;
  whatsapp: boolean;
  usageToday: { actor: string; calls: number; failed: number; prompt: number; completion: number }[];
}
export interface MandateTarget {
  matterId: string;
  title: string;
  clientName: string;
  status: string;
  restricted: boolean;
}

export const core = <T>(action: string, payload: object = {}) => callModule<T>('core', action, payload);

// Errors
export const errorStatus = (e: unknown) => (e instanceof ModuleError ? e.status : 0);
export function errorMessage(e: unknown) {
  if (e instanceof ModuleError && e.status === 404 && /unknown workspace action/i.test(e.message))
    return 'This part of the assistant is not available yet. Try again a little later.';
  return e instanceof Error && e.message ? e.message : 'The workspace request failed.';
}
export const isConflict = (e: unknown) => errorStatus(e) === 409;
export const CONFLICT = 'This changed elsewhere. The latest version has been loaded.';

// India time. A date-only due time is stored as 23:59 India time on that date.
export function istParts(ms: number) {
  const d = new Date(ms + IST_OFFSET);
  const iso = d.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}
export function fromIst(date: string, time: string) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = (time || '23:59').split(':').map(Number);
  return Date.UTC(y, m - 1, d, h, mi) - IST_OFFSET;
}
export const todayIst = (now = Date.now()) => istParts(now).date;
export function addDaysIso(date: string, n: number) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export const isDateOnly = (ms: number) => istParts(ms).time === '23:59';

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
export const formatDay = (date: string) =>
  new Date(date + 'T00:00:00Z').toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
export const formatLongDay = (date: string) =>
  new Date(date + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' }) +
  ', ' +
  formatDay(date);

function dayWord(date: string, now: number) {
  const today = todayIst(now);
  if (date === today) return 'Today';
  if (date === addDaysIso(today, 1)) return 'Tomorrow';
  if (date === addDaysIso(today, -1)) return 'Yesterday';
  const [ty] = today.split('-');
  const label = formatDay(date);
  return date.startsWith(ty) ? label.replace(/\s\d{4}$/, '') : label;
}

// "Today, 4:00 pm", "Tomorrow", "27 Oct, 9:00 am", "3 Jan 2027".
export function formatWhen(ms: number, now = Date.now()) {
  const { date } = istParts(ms);
  const day = dayWord(date, now);
  return isDateOnly(ms) ? day : `${day}, ${clock(ms)}`;
}
// For lists of past events: "5 min ago", "Today, 9:10 am", "24 Oct, 6:00 pm".
export function formatAgo(ms: number, now = Date.now()) {
  const mins = Math.round((now - ms) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const { date } = istParts(ms);
  return `${dayWord(date, now)}, ${clock(ms)}`;
}
export const formatClock = clock;

// Minutes from now to 9 am India time tomorrow.
export function minutesToTomorrowNine(now = Date.now()) {
  const target = fromIst(addDaysIso(todayIst(now), 1), '09:00');
  return Math.max(1, Math.round((target - now) / 60000));
}

// Links stored by the server are page ids, optionally with "#id". Unknown ids fall back sensibly.
export function pageFor(link: string | undefined | null) {
  if (!link) return null;
  const id = link.split('#')[0].split('?')[0].trim();
  if (!id) return null;
  if (findPage(id)) return id;
  if (/^assistant\/(reminders?|todos?)/.test(id)) return 'assistant/todos';
  const mod = id.split('/')[0];
  const first = ['assistant/today', 'mail/inbox', 'workflow/dashboard'].find((p) => p.startsWith(mod + '/'));
  return first && findPage(first) ? first : null;
}

export const MODULE_LABELS: Record<string, string> = {
  assistant: 'Assistant',
  mail: 'Mail',
  workflow: 'Workflow',
  scribe: 'Scribe',
  core: 'Workspace',
};

// Loads data on mount and on reload(); state changes happen only after the request settles.
export type Load<T> = {
  phase: 'loading' | 'ready' | 'error';
  data: T | null;
  error: string;
  status: number;
};
export function useLoad<T>(fetcher: () => Promise<T>) {
  const ref = useRef(fetcher);
  useEffect(() => {
    ref.current = fetcher;
  });
  const [state, setState] = useState<Load<T>>({ phase: 'loading', data: null, error: '', status: 0 });
  const seq = useRef(0);
  const run = useCallback(() => {
    const n = ++seq.current;
    return ref.current().then(
      (data) => {
        if (n === seq.current) setState({ phase: 'ready', data, error: '', status: 0 });
        return data;
      },
      (e: unknown) => {
        if (n === seq.current)
          setState((s) => ({
            ...s,
            phase: s.data ? 'ready' : 'error',
            error: errorMessage(e),
            status: errorStatus(e),
          }));
        return null;
      },
    );
  }, []);
  useEffect(() => {
    void run();
  }, [run]);
  // Shows the loading state again, then reloads (for "Try again").
  const retry = useCallback(() => {
    setState((s) => ({ ...s, phase: 'loading', error: '' }));
    return run();
  }, [run]);
  const set = useCallback(
    (update: (data: T) => T) => setState((s) => (s.data ? { ...s, data: update(s.data) } : s)),
    [],
  );
  return { ...state, reload: run, retry, set };
}

// True while a media query matches (for example the phone layout).
export function useMedia(query: string) {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    queueMicrotask(on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

export function firstName(name: string | undefined | null) {
  return (name || '').trim().split(/\s+/)[0] || '';
}
export function greeting(now = Date.now()) {
  const h = Number(istParts(now).time.slice(0, 2));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

// The current time, for event handlers.
export const nowMs = () => Date.now();
// The current time for rendering, refreshed every minute.
export function useClock(ms = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
