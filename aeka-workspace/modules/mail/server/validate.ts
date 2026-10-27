// Input validation for mail actions and for model replies. Messages are shown to members as they are.
import { CloudError } from '../../../lib/cloud-store.ts';
import {
  CATEGORIES,
  HANDLING,
  TIERS,
  VIEWS,
  type Address,
  type Category,
  type Handling,
  type MailRule,
  type MailView,
  type RuleEffect,
  type Tier,
} from '../shared/types.ts';

type Obj = Record<string, unknown>;
const bad = (message: string) => new CloudError(message);
export const EMAIL = /^[^\s@<>()",;]{1,64}@[^\s@<>()",;]{1,190}\.[^\s@<>()",;]{2,}$/;
const ID = /^[A-Za-z0-9_-]{1,80}$/;

export const idOf = (value: unknown, label = 'email') => {
  if (typeof value !== 'string' || !ID.test(value))
    throw new CloudError(`This ${label} could not be found.`, 404);
  return value;
};

export function obj(value: unknown, label: string): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw bad(`Send the ${label}.`);
  return value as Obj;
}

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

export function baseRevision(p: Obj) {
  const r = p.baseRevision;
  if (typeof r !== 'number' || !Number.isInteger(r) || r < 0) throw bad('Reload and try again.');
  return r;
}

export const isTier = (v: unknown): v is Tier => (TIERS as readonly unknown[]).includes(v);
export const isCategory = (v: unknown): v is Category => (CATEGORIES as readonly unknown[]).includes(v);
export const isHandling = (v: unknown): v is Handling => (HANDLING as readonly unknown[]).includes(v);

export function view(value: unknown): MailView {
  if (!(VIEWS as readonly unknown[]).includes(value)) throw bad('Choose a valid view.');
  return value as MailView;
}

export function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value && value >= '2000-01-01';
}

export function email(value: unknown, label: string) {
  const s = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!EMAIL.test(s) || s.length > 254) throw bad(`Enter a valid email address for ${label}.`);
  return s;
}

export function recipients(value: unknown, label: string): Address[] {
  if (!Array.isArray(value)) throw bad(`Send ${label} as a list.`);
  if (value.length > 50) throw bad(`Keep ${label} to 50 people or fewer.`);
  const seen = new Set<string>();
  const out: Address[] = [];
  for (const v of value) {
    const a = obj(v, 'recipient');
    const address = email(a.address, label);
    if (seen.has(address)) continue;
    seen.add(address);
    out.push({ address, name: text(a.name, 'the recipient name', 200) });
  }
  return out;
}

// A rule's pattern in its stored form: lower-case address, domain or subject phrase.
export function rulePattern(kind: MailRule['kind'], value: unknown) {
  const s = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (kind === 'sender') return email(s, 'the sender');
  if (kind === 'domain') {
    const d = s.replace(/^@/, '');
    if (!/^([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/.test(d)) throw bad('Enter a valid domain, such as client.com.');
    return d;
  }
  if (s.length < 3 || s.length > 120) throw bad('Enter a subject phrase of 3 to 120 characters.');
  return s.replace(/\s+/g, ' ');
}

// A rule effect; matterId visibility is checked by the caller.
export function ruleEffect(value: unknown): RuleEffect {
  const e = obj(value, 'rule effect');
  const out: RuleEffect = {};
  if (e.tier != null) {
    if (!isTier(e.tier)) throw bad('Choose a valid tier.');
    out.tier = e.tier;
  }
  if (e.category != null) {
    if (!isCategory(e.category)) throw bad('Choose a valid category.');
    out.category = e.category;
  }
  if (e.handling != null) {
    if (!isHandling(e.handling)) throw bad('Choose a valid handling.');
    out.handling = e.handling;
  }
  if (e.matterId != null) {
    if (typeof e.matterId !== 'string' || !ID.test(e.matterId)) throw bad('Choose a valid mandate.');
    out.matterId = e.matterId;
  }
  if (e.neverAi != null) out.neverAi = bool(e.neverAi, 'keeping this mail from AI');
  if (e.vip != null) out.vip = bool(e.vip, 'marking as a VIP');
  if (!Object.keys(out).length) throw bad('Choose what the rule should set.');
  return out;
}

// Removes em and en dashes from model text, as house style requires.
export const houseDashes = (s: string) =>
  s
    .replace(/(\d)\s*[–—]\s*(\d)/g, '$1 to $2')
    .replace(/\s*[–—]\s*/g, ', ')
    .replace(/ ,/g, ',');
