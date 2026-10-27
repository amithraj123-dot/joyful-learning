// Input validation for assistant actions and tools. Every value from the browser, the model or
// WhatsApp is checked here before use; the messages are shown to members as they are.
import { CloudError } from '../../../lib/cloud-store.ts';
import type { ModuleContext } from '../../../core/server/module.ts';

type Obj = Record<string, unknown>;
export const bad = (message: string) => new CloudError(message);
export const notFound = (label: string) => new CloudError(`This ${label} could not be found.`, 404);
export const conflict = (label: string) =>
  new CloudError(`This ${label} changed since you opened it. Reload and try again.`, 409);

export const LIMITS = {
  title: 240,
  list: 40,
  details: 5000,
  memoryContent: 4000,
  chatText: 4000,
  conversationTitle: 120,
  openTodos: 500,
  activeReminders: 200,
  memories: 300,
};

// The caller's member email. The router admits only active members, so this is always present.
export function owner(ctx: ModuleContext) {
  if (!ctx.member) throw new CloudError('You do not have permission for this action.', 403);
  return ctx.member.email;
}

export function obj(value: unknown, label: string): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw bad(`Send the ${label} details.`);
  return value as Obj;
}

// Trimmed text of at most `max` characters; `required` also refuses an empty value.
export function text(value: unknown, label: string, max: number, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string') throw bad(`Enter ${label} as text.`);
  const s = value.trim();
  if (required && !s) throw bad(`Enter ${label}.`);
  if (s.length > max) throw bad(`Keep ${label} to ${max.toLocaleString('en-IN')} characters or fewer.`);
  return s;
}

export function bool(value: unknown, label: string) {
  if (typeof value !== 'boolean') throw bad(`Choose yes or no for ${label}.`);
  return value;
}

export function oneOf<T extends string>(value: unknown, options: readonly T[], label: string): T {
  if (!options.includes(value as T)) throw bad(`Choose a valid ${label}.`);
  return value as T;
}

export function int(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    throw bad(`Enter ${label} as a whole number from ${min} to ${max.toLocaleString('en-IN')}.`);
  return value;
}

const ID = /^[A-Za-z0-9_-]{1,80}$/;
// A record id; anything malformed is reported as not found, like a missing record.
export function recordId(value: unknown, label: string) {
  if (typeof value !== 'string' || !ID.test(value)) throw notFound(label);
  return value;
}

export function revision(value: unknown) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
    throw bad('Send the revision you started from.');
  return value;
}

// Times are milliseconds between 2000 and 2100.
const MIN_TIME = Date.UTC(2000, 0, 1);
const MAX_TIME = Date.UTC(2100, 0, 1);
export function time(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < MIN_TIME || value > MAX_TIME)
    throw bad(`Choose a valid ${label}.`);
  return value;
}
export const optionalTime = (value: unknown, label: string) => (value == null ? null : time(value, label));

// An ISO 8601 date and time with an explicit offset (Z or +05:30), as the model is asked to send.
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
export function isoTime(value: unknown, label: string) {
  if (typeof value !== 'string' || !ISO.test(value.trim()))
    throw bad(`Give ${label} as an ISO date and time with an offset, for example 2026-10-27T15:00:00+05:30.`);
  return time(Date.parse(value.trim()), label);
}

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// Passwords and card numbers do not belong in memory (it is not a secret vault).
export function looksSecret(s: string) {
  if (/\b(password|passwd|passcode|cvv|cvc|otp|upi pin|atm pin)\b/i.test(s)) return true;
  for (const m of s.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) {
    const digits = m[0].replace(/\D/g, '');
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      let d = Number(digits[digits.length - 1 - i]);
      if (i % 2) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
      sum += d;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}
