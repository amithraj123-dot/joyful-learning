// Small browser helpers for the Workflow pages: dates in India time, people, sorting and ids.
import { ModuleError } from '../../../core/client/api';
import type { Matter, PersonKey, Task } from '../shared/types';

export const DESIGNATIONS = [
  'Article',
  'Associate',
  'Assistant Manager',
  'Manager',
  'Director',
  'Partner',
] as const;
export type Designation = (typeof DESIGNATIONS)[number];

// Firm member as returned by core members.list (mirrors core/server/members.ts).
export interface Member {
  email: string;
  name: string;
  initials: string;
  designation: Designation;
  isAdmin: boolean;
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface MeInfo {
  email: string;
  member: Member | null;
}

export interface ActivityEntry {
  id: string;
  at: number;
  actor: string;
  actorName: string;
  module: string;
  action: string;
  target: string;
  summary: string;
}

export const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : 'The workspace request failed.';
export const errorStatus = (e: unknown) => (e instanceof ModuleError ? e.status : 0);

export function uid() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Dates are calendar dates (YYYY-MM-DD) in India time; parse them as UTC to avoid shifting a day.
const parts = (d: string) => d.split('-').map(Number) as [number, number, number];
const utc = (d: string) => {
  const [y, m, day] = parts(d);
  return new Date(Date.UTC(y, m - 1, day));
};
export const formatDate = (d: string | null | undefined) =>
  d
    ? utc(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : '-';
export const formatMonth = (d: string) =>
  utc(d).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const formatWeekday = (d: string) =>
  utc(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
export const formatStamp = (ms: number) =>
  new Date(ms).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
export const addDays = (d: string, n: number) => {
  const x = utc(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
// Monday of the week containing d.
export const weekStart = (d: string) => {
  const day = utc(d).getUTCDay();
  return addDays(d, day === 0 ? -6 : 1 - day);
};

export const formatHours = (minutes: number) => {
  const h = minutes / 60;
  return (Number.isInteger(h) ? h.toString() : h.toFixed(2).replace(/0$/, '')) + ' h';
};

export const rank = (m: Pick<Member, 'designation'> | undefined) =>
  m ? DESIGNATIONS.indexOf(m.designation) + 1 : 0;

export const isLegacy = (key: PersonKey) => key.startsWith('legacy:');

export function personLabel(key: PersonKey | null | undefined, members: Member[]) {
  if (!key) return { initials: '', name: 'Unassigned', legacy: false, member: undefined };
  if (isLegacy(key)) {
    const initials = key.slice(7);
    return { initials, name: `${initials} (not yet mapped)`, legacy: true, member: undefined };
  }
  const member = members.find((m) => m.email === key);
  if (member) return { initials: member.initials, name: member.name, legacy: false, member };
  return { initials: key.slice(0, 2).toUpperCase(), name: key, legacy: false, member: undefined };
}

export const isDone = (t: Pick<Task, 'status'>) => t.status === 'Completed';

export const byTaskOrder = (a: Task, b: Task) =>
  Number(b.priority) - Number(a.priority) ||
  (a.dueDate || '9999').localeCompare(b.dueDate || '9999') ||
  a.createdAt - b.createdAt;

export const matterSort = (a: Matter, b: Matter) =>
  Number(a.status === 'closed') - Number(b.status === 'closed') ||
  Number(b.priority) - Number(a.priority) ||
  Number(b.status === 'urgent') - Number(a.status === 'urgent') ||
  b.createdAt - a.createdAt;

export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export function download(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
