// Input validation for workflow actions. Every value from the browser is checked here before use; the
// messages are shown to users as they are.
import { CloudError } from '../../../lib/cloud-store.ts';
import {
  DOC_STATUSES,
  EL_STATUSES,
  INVOICE_STATUSES,
  MATTER_STAGES,
  MATTER_STATUSES,
  MILESTONE_KINDS,
  RESIDENCY,
  TASK_STATUSES,
  type Counterparty,
  type DealDoc,
  type TaskStep,
} from '../shared/types.ts';
import type {
  BillingInput,
  ClientInput,
  DealInput,
  InvoiceInput,
  MilestoneInput,
} from '../shared/contract.ts';

type Obj = Record<string, unknown>;
const bad = (message: string) => new CloudError(message);

export const MAX_PAISE = 1e12; // ₹1,000 crore
const ID = /^[A-Za-z0-9_-]{1,80}$/;
export const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const LEGACY_KEY = /^legacy:[A-Z0-9]{1,8}$/;

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

export function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value && value >= '2000-01-01';
}
export function date(value: unknown, label: string) {
  if (!isDate(value)) throw bad(`Enter ${label} as a valid date (YYYY-MM-DD).`);
  return value;
}
export const optionalDate = (value: unknown, label: string) =>
  value == null || value === '' ? null : date(value, label);

// Days from date a to date b (YYYY-MM-DD).
export const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86400000;

export const id = (value: unknown) => (typeof value === 'string' && ID.test(value) ? value : '');

export function baseRevision(p: Obj) {
  const r = p.baseRevision;
  if (typeof r !== 'number' || !Number.isInteger(r) || r < 0) throw bad('Reload and try again.');
  return r;
}

// A person key's shape; whether it names a real member is checked in people.ts.
export function personShape(value: unknown, label: string) {
  if (typeof value !== 'string' || !(EMAIL.test(value) || LEGACY_KEY.test(value)))
    throw bad(`Choose a valid ${label}.`);
  return value.startsWith('legacy:') ? value : value.toLowerCase();
}

function list(value: unknown, label: string, max: number) {
  if (!Array.isArray(value)) throw bad(`Send ${label} as a list.`);
  if (value.length > max) throw bad(`Keep ${label} to ${max} or fewer.`);
  return value as unknown[];
}

function uniqueIds(items: { id: string }[], label: string) {
  if (new Set(items.map((x) => x.id)).size !== items.length) throw bad(`Each ${label} needs its own id.`);
}
function uniqueNames(items: { name: string }[], label: string) {
  const seen = new Set<string>();
  for (const x of items) {
    const k = x.name.toLowerCase();
    if (seen.has(k)) throw bad(`${label} "${x.name}" appears more than once.`);
    seen.add(k);
  }
}
const itemId = (value: unknown, label: string) => {
  if (!id(value)) throw bad(`Each ${label} needs a valid id.`);
  return value as string;
};

export const validClient = (value: unknown): ClientInput => {
  const c = obj(value, 'client');
  return { name: text(c.name, 'the client name', 200, true), notes: text(c.notes, 'the notes', 2000) };
};

// Matter fields other than the team and client, which need the database.
export function matterFields(m: Obj) {
  return {
    title: text(m.title, 'the matter title', 200, true),
    type: text(m.type, 'the matter type', 80, true),
    status: oneOf(m.status, MATTER_STATUSES, 'status'),
    stage: oneOf(m.stage, MATTER_STAGES, 'stage'),
    priority: bool(m.priority, 'priority'),
    note: text(m.note, 'the status note', 5000),
    restricted: bool(m.restricted, 'restricted access'),
    peerFeedbackVisible: bool(m.peerFeedbackVisible, 'peer feedback visibility'),
    isDeal: bool(m.isDeal, 'deal tracker'),
  };
}
export const teamList = (value: unknown) => {
  const keys = list(value, 'team members', 50).map((k) => personShape(k, 'team member'));
  return [...new Set(keys)];
};

export function steps(value: unknown): TaskStep[] {
  const out = list(value ?? [], 'checklist steps', 100).map((s) => {
    const step = obj(s, 'checklist step');
    return {
      id: itemId(step.id, 'checklist step'),
      text: text(step.text, 'the step', 300, true),
      done: bool(step.done, 'step completion'),
    };
  });
  uniqueIds(out, 'checklist step');
  return out;
}

export function taskFields(t: Obj) {
  return {
    title: text(t.title, 'the task title', 300, true),
    status: oneOf(t.status, TASK_STATUSES, 'task status'),
    dueDate: optionalDate(t.dueDate, 'the due date'),
    priority: bool(t.priority, 'priority'),
    notes: text(t.notes, 'the notes', 5000),
    steps: steps(t.steps),
  };
}

export const timeFields = (e: Obj) => ({
  date: date(e.date, 'the date'),
  minutes: int(e.minutes, 'the minutes', 1, 1440),
  description: text(e.description, 'the description', 500),
  billable: bool(e.billable, 'billable'),
});

export const milestoneFields = (m: Obj): Omit<MilestoneInput, 'matterId' | 'owner'> => ({
  title: text(m.title, 'the milestone title', 200, true),
  kind: oneOf(m.kind, MILESTONE_KINDS, 'milestone type'),
  dueDate: date(m.dueDate, 'the due date'),
  done: bool(m.done, 'completion'),
});

export function validBilling(value: unknown): BillingInput {
  const b = obj(value, 'billing');
  return {
    elStatus: oneOf(b.elStatus, EL_STATUSES, 'engagement letter status'),
    invoiceStatus: oneOf(b.invoiceStatus, INVOICE_STATUSES, 'invoice status'),
    feePaise: b.feePaise == null ? null : int(b.feePaise, 'the fee (in paise)', 0, MAX_PAISE),
    adminNotes: text(b.adminNotes, 'the billing notes', 2000),
  };
}

export function validInvoice(value: unknown): InvoiceInput {
  const i = obj(value, 'invoice');
  return {
    invoiceNo: text(i.invoiceNo, 'the invoice number', 60),
    date: date(i.date, 'the invoice date'),
    amountPaise: int(i.amountPaise, 'the amount (in paise)', 1, MAX_PAISE),
    entity: text(i.entity, 'the entity', 200),
    notes: text(i.notes, 'the notes', 1000),
  };
}

function docs(value: unknown, label: string): DealDoc[] {
  const out = list(value, label, 50).map((x) => {
    const d = obj(x, 'document');
    return {
      id: itemId(d.id, 'document'),
      name: text(d.name, 'the document name', 120, true),
      status: oneOf(d.status, DOC_STATUSES, 'document status'),
      notes: text(d.notes, 'the document notes', 1000),
    };
  });
  uniqueNames(out, 'Document');
  return out;
}

export function validDeal(value: unknown): DealInput {
  const d = obj(value, 'deal tracker');
  const counterparties: Counterparty[] = list(d.counterparties, 'counterparties', 100).map((x) => {
    const c = obj(x, 'counterparty');
    return {
      id: itemId(c.id, 'counterparty'),
      name: text(c.name, 'the counterparty name', 200, true),
      incomeTax: oneOf(c.incomeTax, RESIDENCY, 'income-tax residency'),
      fema: oneOf(c.fema, RESIDENCY, 'FEMA residency'),
      docs: docs(c.docs, 'documents for each counterparty'),
    };
  });
  uniqueNames(counterparties, 'Counterparty');
  const targetDocs = docs(d.targetDocs, 'target company documents');
  uniqueIds([...targetDocs, ...counterparties, ...counterparties.flatMap((c) => c.docs)], 'document');
  return {
    dealValue: text(d.dealValue, 'the deal value', 120),
    representing: oneOf(d.representing, ['Buy Side', 'Sell Side'] as const, 'side'),
    targetCompany: text(d.targetCompany, 'the target company', 200),
    targetDocs,
    counterparties,
  };
}
