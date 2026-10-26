// Workflow tables: how each record maps to its row, and the few SQL helpers the actions share.
// Column names are the snake_case of the record field; booleans are stored as 0/1, arrays as JSON text.
import { CloudError } from '../../../lib/cloud-store.ts';
import type {
  Client,
  DealTracker,
  Feedback,
  Invoice,
  Matter,
  MatterBilling,
  MeetingLink,
  Milestone,
  Task,
  TimeEntry,
} from '../shared/types.ts';

type Kind = 'value' | 'bool' | 'json';
export interface Table<T> {
  name: string;
  key: keyof T & string;
  cols: { [K in keyof T & string]: Kind };
}
type Row = Record<string, unknown>;

const column = (field: string) => field.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
const v = 'value' as const;

export const clients: Table<Client> = {
  name: 'wf_clients',
  key: 'id',
  cols: { id: v, name: v, notes: v, createdAt: v, updatedAt: v, revision: v, deletedAt: v },
};
export const matters: Table<Matter> = {
  name: 'wf_matters',
  key: 'id',
  cols: {
    id: v,
    clientId: v,
    title: v,
    type: v,
    status: v,
    stage: v,
    priority: 'bool',
    note: v,
    team: 'json',
    restricted: 'bool',
    peerFeedbackVisible: 'bool',
    isDeal: 'bool',
    createdAt: v,
    updatedAt: v,
    revision: v,
    deletedAt: v,
  },
};
export type BillingRow = Omit<MatterBilling, 'billedPaise'>;
export const billing: Table<BillingRow> = {
  name: 'wf_billing',
  key: 'matterId',
  cols: {
    matterId: v,
    elStatus: v,
    invoiceStatus: v,
    feePaise: v,
    adminNotes: v,
    revision: v,
    updatedAt: v,
  },
};
export const invoices: Table<Invoice> = {
  name: 'wf_invoices',
  key: 'id',
  cols: {
    id: v,
    matterId: v,
    invoiceNo: v,
    date: v,
    amountPaise: v,
    entity: v,
    notes: v,
    createdBy: v,
    createdAt: v,
  },
};
export const tasks: Table<Task> = {
  name: 'wf_tasks',
  key: 'id',
  cols: {
    id: v,
    matterId: v,
    title: v,
    status: v,
    assignee: v,
    preparedBy: v,
    reviewedBy: v,
    reviewedAt: v,
    dueDate: v,
    priority: 'bool',
    notes: v,
    steps: 'json',
    createdBy: v,
    createdAt: v,
    updatedAt: v,
    revision: v,
    deletedAt: v,
  },
};
export const time: Table<TimeEntry> = {
  name: 'wf_time',
  key: 'id',
  cols: {
    id: v,
    matterId: v,
    person: v,
    date: v,
    minutes: v,
    description: v,
    billable: 'bool',
    createdBy: v,
    createdAt: v,
    updatedAt: v,
  },
};
export const milestones: Table<Milestone> = {
  name: 'wf_milestones',
  key: 'id',
  cols: {
    id: v,
    matterId: v,
    title: v,
    kind: v,
    dueDate: v,
    done: 'bool',
    owner: v,
    createdAt: v,
    updatedAt: v,
    revision: v,
  },
};
export const deals: Table<DealTracker> = {
  name: 'wf_deals',
  key: 'matterId',
  cols: {
    matterId: v,
    dealValue: v,
    representing: v,
    targetCompany: v,
    targetDocs: 'json',
    counterparties: 'json',
    revision: v,
    updatedAt: v,
  },
};
export const feedback: Table<Feedback> = {
  name: 'wf_feedback',
  key: 'id',
  cols: {
    id: v,
    matterId: v,
    member: v,
    kind: v,
    text: v,
    rating: v,
    author: v,
    updatedAt: v,
    revision: v,
  },
};

// ownerUser is server-only: the owner's sign-in id, which keys their Scribe notes.
export type MeetingLinkRow = MeetingLink & { ownerUser: string };
export const meetingLinks: Table<MeetingLinkRow> = {
  name: 'wf_meeting_links',
  key: 'id',
  cols: {
    id: v,
    matterId: v,
    ownerUser: v,
    noteId: v,
    title: v,
    meetingAt: v,
    attendees: 'json',
    summary: v,
    actions: 'json',
    includeTranscript: 'bool',
    transcriptChars: v,
    linkedBy: v,
    createdAt: v,
    updatedAt: v,
    revision: v,
  },
};
export const meetingTranscripts: Table<{ linkId: string; transcript: string }> = {
  name: 'wf_meeting_transcripts',
  key: 'linkId',
  cols: { linkId: v, transcript: v },
};

const fields = <T>(t: Table<T>) => Object.keys(t.cols) as (keyof T & string)[];

function fromRow<T>(t: Table<T>, row: Row): T {
  const out: Row = {};
  for (const f of fields(t)) {
    const value = row[column(f)];
    out[f] = t.cols[f] === 'bool' ? !!value : t.cols[f] === 'json' ? JSON.parse(String(value)) : value;
  }
  return out as T;
}

function toValues<T>(t: Table<T>, record: T, only = fields(t)) {
  return only.map((f) => {
    const value = record[f] as unknown;
    return t.cols[f] === 'bool' ? (value ? 1 : 0) : t.cols[f] === 'json' ? JSON.stringify(value) : value;
  });
}

export async function all<T>(db: D1Database, t: Table<T>, where = '1', ...params: unknown[]) {
  const r = await db
    .prepare(`SELECT * FROM ${t.name} WHERE ${where}`)
    .bind(...params)
    .all<Row>();
  return r.results.map((row) => fromRow(t, row));
}

export async function one<T>(db: D1Database, t: Table<T>, where: string, ...params: unknown[]) {
  const row = await db
    .prepare(`SELECT * FROM ${t.name} WHERE ${where} LIMIT 1`)
    .bind(...params)
    .first<Row>();
  return row ? fromRow(t, row) : null;
}

// INSERT; with skipExisting a clash on the key (or a unique index) inserts nothing, for idempotent imports.
export function insert<T>(db: D1Database, t: Table<T>, record: T, skipExisting = false) {
  const cols = fields(t);
  return db
    .prepare(
      `INSERT INTO ${t.name}(${cols.map(column).join(',')}) VALUES(${cols.map(() => '?').join(',')})${
        skipExisting ? ' ON CONFLICT DO NOTHING' : ''
      }`,
    )
    .bind(...toValues(t, record));
}

// INSERT only when `condition` (SQL over other tables) holds at that point of the transaction.
export function insertWhere<T>(
  db: D1Database,
  t: Table<T>,
  record: T,
  condition: string,
  ...params: unknown[]
) {
  const cols = fields(t);
  return db
    .prepare(
      `INSERT INTO ${t.name}(${cols.map(column).join(',')}) SELECT ${cols.map(() => '?').join(',')} WHERE ${condition}`,
    )
    .bind(...toValues(t, record), ...params);
}

// UPDATE every column of the record; with baseRevision only if the stored row still has that revision.
export function update<T>(db: D1Database, t: Table<T>, record: T, baseRevision?: number) {
  const cols = fields(t).filter((f) => f !== t.key);
  const check = baseRevision === undefined ? '' : ' AND revision = ?';
  return db
    .prepare(
      `UPDATE ${t.name} SET ${cols.map((f) => column(f) + ' = ?').join(', ')} WHERE ${column(t.key)} = ?${check}`,
    )
    .bind(...toValues(t, record, cols), record[t.key], ...(baseRevision === undefined ? [] : [baseRevision]));
}

export function remove<T>(db: D1Database, t: Table<T>, key: string) {
  return db.prepare(`DELETE FROM ${t.name} WHERE ${column(t.key)} = ?`).bind(key);
}

// The workflow version: last write time in ms, always increasing, so polling clients notice every change.
const bump = (db: D1Database, now: number) =>
  db
    .prepare(
      "INSERT INTO wf_meta(key,value) VALUES('version',?) ON CONFLICT(key) DO UPDATE SET value = max(wf_meta.value + 1, excluded.value)",
    )
    .bind(now);

export async function readVersion(db: D1Database) {
  const r = await db
    .prepare("SELECT value FROM wf_meta WHERE key = 'version'")
    .bind()
    .first<{ value: number }>();
  return r?.value ?? 0;
}

// Runs the statements and the version bump in one transaction; returns rows changed per statement.
export async function write(db: D1Database, now: number, statements: D1PreparedStatement[]) {
  const results = await db.batch([...statements, bump(db, now)]);
  return results.slice(0, statements.length).map((r) => r.meta.changes);
}

export const notFound = (label: string) => new CloudError(`This ${label} could not be found.`, 404);
export const conflict = (label: string) =>
  new CloudError(`This ${label} changed since you opened it. Reload and try again.`, 409);

// Saves a revisioned record if nobody else saved it since baseRevision was read.
export async function saveRevision<T extends { revision: number }>(
  db: D1Database,
  now: number,
  t: Table<T>,
  record: T,
  baseRevision: number,
  label: string,
) {
  const [changed] = await write(db, now, [update(db, t, record, baseRevision)]);
  if (!changed) throw conflict(label);
  return record;
}
