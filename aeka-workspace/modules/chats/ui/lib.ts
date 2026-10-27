// Small helpers for the Chats pages.
import { ModuleError } from '../../../core/client/api';
import type { ChatThread } from '../shared/types';

export const errorMessage = (e: unknown) =>
  e instanceof ModuleError || e instanceof Error ? e.message : 'Something went wrong. Try again.';
export const isConflict = (e: unknown) => e instanceof ModuleError && e.status === 409;

const MIN = 60000;
const TZ = 'Asia/Kolkata';
const dayKey = (ms: number) => new Date(ms).toLocaleDateString('en-IN', { timeZone: TZ });
// "4:05 pm" today, "Yesterday", "Tue", or "28 Oct", in India time.
export function whenLabel(ms: number, now = Date.now()) {
  const d = new Date(ms);
  if (dayKey(ms) === dayKey(now))
    return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
  if (dayKey(ms) === dayKey(now - 86400000)) return 'Yesterday';
  if (now - ms < 6 * 86400000) return d.toLocaleDateString('en-IN', { weekday: 'short', timeZone: TZ });
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: TZ });
}
export function fullTime(ms: number) {
  return new Date(ms).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TZ,
  });
}
export function waitedLabel(since: number | null, now = Date.now()) {
  if (since == null) return '';
  const ms = Math.max(0, now - since);
  if (ms < 60 * MIN) return `${Math.max(1, Math.round(ms / MIN))} min`;
  if (ms < 48 * 60 * MIN) return `${Math.round(ms / (60 * MIN))} h`;
  return `${Math.round(ms / (24 * 60 * MIN))} days`;
}
export const initials = (t: ChatThread) =>
  t.title
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '#';
export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
