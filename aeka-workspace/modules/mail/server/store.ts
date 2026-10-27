// Mail tables: row shapes, mapping to the shared records, and the queries the actions share. Every
// query is scoped to one member's email; no query reads another member's rows.
import { CloudError } from '../../../lib/cloud-store.ts';
import type { ServerEnv } from '../../../core/server/env.ts';
import type { ModuleContext } from '../../../core/server/module.ts';
import {
  CATEGORIES,
  HANDLING,
  isBusy,
  type AccountSettings,
  type Address,
  type CalendarEvent,
  type CalendarStatus,
  type Category,
  type Draft,
  type DraftSummary,
  type Handling,
  type MailAccount,
  type MailItem,
  type MailMessage,
  type MailRule,
  type MailView,
  type QueueCounts,
  type RuleEffect,
  type Tier,
  type Triage,
} from '../shared/types.ts';

// Background work runs with this context (the router's ModuleContext also satisfies it).
export interface Sys {
  db: D1Database;
  env: ServerEnv;
  fetch: typeof fetch;
  now: number;
}

export const memberOf = (ctx: ModuleContext) => {
  if (!ctx.member) throw new CloudError('You do not have permission for this action.', 403);
  return ctx.member.email;
};

export const notFound = (label: string) => new CloudError(`This ${label} could not be found.`, 404);
export const conflict = (label: string) =>
  new CloudError(`This ${label} changed since you opened it. Reload and try again.`, 409);

export const DEFAULT_SETTINGS: AccountSettings = {
  aiTriage: true,
  alertUrgent: true,
  archiveNoise: false,
  autoTodos: true,
  trackCommitments: true,
};
export const MINUTE = 60000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

// Deterministic message ids, so the message and its triage row can be written in one batch.
export async function messageKey(member: string, graphId: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(member + '\n' + graphId)),
  );
  return 'm' + [...bytes.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const domainOf = (address: string) => address.split('@')[1]?.toLowerCase() || '';
// Personal mail domains: a shared domain says nothing about the client, so it never links a mandate.
export const PUBLIC_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.co.in',
  'yahoo.in',
  'rediffmail.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'zoho.com',
]);
export const isPublicDomain = (d: string) => !d || PUBLIC_DOMAINS.has(d);

const json = <T>(text: unknown, fallback: T): T => {
  try {
    return text == null || text === '' ? fallback : (JSON.parse(String(text)) as T);
  } catch {
    return fallback;
  }
};

// Accounts

export interface AccountRow {
  member: string;
  address: string;
  display_name: string;
  token_sealed: string;
  access_expires: number;
  status: MailAccount['status'];
  inbox_delta: string | null;
  sent_delta: string | null;
  last_sync_at: number | null;
  last_error: string;
  settings: string;
  calendar_status: CalendarStatus;
  calendar_synced_at: number | null;
  created_at: number;
  updated_at: number;
}

export const settingsOf = (row: Pick<AccountRow, 'settings'>): AccountSettings => ({
  ...DEFAULT_SETTINGS,
  ...json<Partial<AccountSettings>>(row.settings, {}),
});

export const toAccount = (r: AccountRow): MailAccount => ({
  address: r.address,
  displayName: r.display_name,
  status: r.status,
  lastSyncAt: r.last_sync_at,
  lastError: r.last_error,
  settings: settingsOf(r),
  calendar: r.calendar_status ?? 'pending',
  calendarSyncedAt: r.calendar_synced_at ?? null,
  connectedAt: r.created_at,
});

export async function loadAccount(db: D1Database, member: string) {
  return db.prepare('SELECT * FROM mail_accounts WHERE member = ?').bind(member).first<AccountRow>();
}

export async function setAccountError(db: D1Database, member: string, error: string, now: number) {
  await db
    .prepare('UPDATE mail_accounts SET last_error = ?, updated_at = ? WHERE member = ?')
    .bind(error.slice(0, 300), now, member)
    .run();
}

// Triage

export interface TriageRow {
  message_id: string;
  member: string;
  status: Triage['status'];
  attempts: number;
  next_attempt_at: number;
  source: Triage['source'];
  tier: number;
  category: string;
  handling: string;
  why: string;
  deadline: string | null;
  asks: string;
  reply_needed: Triage['replyNeeded'];
  draft_decision: Triage['draftDecision'];
  delegate: string | null;
  matter_id: string | null;
  matter_confidence: Triage['matterConfidence'];
  confidence: number;
  safety_flag: string | null;
  corrected: number;
  model: string;
  error: string;
  triaged_at: number | null;
  updated_at: number;
  revision: number;
}

const tierOf = (n: unknown): Tier => ([1, 2, 3, 4].includes(Number(n)) ? (Number(n) as Tier) : 3);
export const toTriage = (r: TriageRow): Triage => ({
  status: r.status,
  source: r.source,
  tier: tierOf(r.tier),
  category: (CATEGORIES as readonly string[]).includes(r.category) ? (r.category as Category) : 'unknown',
  handling: (HANDLING as readonly string[]).includes(r.handling) ? (r.handling as Handling) : 'uncertain',
  why: r.why,
  deadline: r.deadline,
  asks: json<string[]>(r.asks, []),
  replyNeeded: r.reply_needed,
  draftDecision: r.draft_decision,
  delegate: r.delegate,
  matterId: r.matter_id,
  matterConfidence: r.matter_confidence,
  confidence: r.confidence,
  safetyFlag: r.safety_flag,
  corrected: !!r.corrected,
  error: r.error,
  triagedAt: r.triaged_at,
  revision: r.revision,
});

export async function loadTriage(db: D1Database, member: string, messageId: string) {
  return db
    .prepare('SELECT * FROM mail_triage WHERE member = ? AND message_id = ?')
    .bind(member, messageId)
    .first<TriageRow>();
}

// The fields a finished triage writes (status done unless stated).
export interface Verdict {
  status?: Triage['status'];
  source: Triage['source'];
  tier: Tier;
  category: Category;
  handling: Handling;
  why: string;
  deadline: string | null;
  asks: string[];
  replyNeeded: Triage['replyNeeded'];
  delegate: string | null;
  matterId: string | null;
  matterConfidence: Triage['matterConfidence'];
  confidence: number;
  safetyFlag: string | null;
  model: string;
}

// Writes a verdict only while the item is still pending, so a finished item is never overwritten by
// an overlapping run. Returns whether it was written.
export async function saveVerdict(
  db: D1Database,
  member: string,
  messageId: string,
  v: Verdict,
  now: number,
) {
  const r = await db
    .prepare(
      `UPDATE mail_triage SET status = ?, source = ?, tier = ?, category = ?, handling = ?, why = ?, deadline = ?,
       asks = ?, reply_needed = ?, delegate = ?, matter_id = ?, matter_confidence = ?, confidence = ?,
       safety_flag = ?, model = ?, error = '', triaged_at = ?, updated_at = ?, revision = revision + 1
       WHERE member = ? AND message_id = ? AND status = 'pending'`,
    )
    .bind(
      v.status ?? 'done',
      v.source,
      v.tier,
      v.category,
      v.handling,
      v.why.slice(0, 300),
      v.deadline,
      JSON.stringify(v.asks.slice(0, 3)),
      v.replyNeeded,
      v.delegate,
      v.matterId,
      v.matterId ? v.matterConfidence : null,
      Math.min(Math.max(v.confidence, 0), 1),
      v.safetyFlag,
      v.model,
      now,
      now,
      member,
      messageId,
    )
    .run();
  return r.meta.changes > 0;
}

// Messages and the inbox views

export interface MessageRow {
  id: string;
  member: string;
  graph_id: string;
  internet_message_id: string;
  conversation_id: string;
  folder: 'inbox' | 'sent';
  subject: string;
  from_address: string;
  from_name: string;
  to_json: string;
  cc_json: string;
  received_at: number;
  preview: string;
  body_text: string;
  has_attachments: number;
  importance: string;
  is_read: number;
  bulk: number; // 1 bulk, 0 not, -1 headers not yet read
  web_link: string;
  removed_at: number | null;
  created_at: number;
  updated_at: number;
  commitments_at: number | null; // sent mail: when it was examined for commitments
  // Meeting invitations: 0 when the times are not read yet, -1 when Outlook could not give them.
  meeting_start: number | null;
  meeting_end: number | null;
}

export const addresses = (text: string) => json<Address[]>(text, []);

export async function loadMessage(db: D1Database, member: string, id: unknown) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(id)) return null;
  return db
    .prepare('SELECT * FROM mail_messages WHERE member = ? AND id = ?')
    .bind(member, id)
    .first<MessageRow>();
}

// The member sent a later message in the conversation, or sent a reply from the workspace.
export const REPLIED = `(EXISTS (SELECT 1 FROM mail_messages s WHERE s.member = m.member AND s.folder = 'sent'
  AND m.conversation_id != '' AND s.conversation_id = m.conversation_id AND s.received_at > m.received_at)
  OR EXISTS (SELECT 1 FROM mail_drafts d WHERE d.member = m.member AND d.message_id = m.id AND d.status = 'sent'))`;
const THREAD = `(SELECT count(*) FROM mail_messages c WHERE c.member = m.member AND m.conversation_id != ''
  AND c.conversation_id = m.conversation_id)`;
// When I last wrote in m's conversation (sent mail, or a reply sent from the workspace); 0 if never.
export const LAST_SENT = `max(coalesce((SELECT max(s.received_at) FROM mail_messages s WHERE s.member = m.member
  AND s.folder = 'sent' AND m.conversation_id != '' AND s.conversation_id = m.conversation_id), 0),
  coalesce((SELECT max(d.sent_at) FROM mail_drafts d JOIN mail_messages dm ON dm.id = d.message_id AND dm.member = d.member
  WHERE d.member = m.member AND d.status = 'sent' AND (dm.id = m.id OR (m.conversation_id != ''
  AND dm.conversation_id = m.conversation_id))), 0))`;
// Inbox messages from m's sender in the conversation since I last wrote (0 when m itself is answered).
export const CHASED = `(CASE WHEN m.folder != 'inbox' OR m.received_at <= ${LAST_SENT} THEN 0
  WHEN m.conversation_id = '' THEN 1 ELSE (SELECT count(*) FROM mail_messages c WHERE c.member = m.member
  AND c.folder = 'inbox' AND c.conversation_id = m.conversation_id AND c.from_address = m.from_address
  AND c.received_at > ${LAST_SENT}) END)`;

const VIEW_WHERE: Record<MailView, string> = {
  needs_me: `t.status = 'done' AND (t.handling = 'reply' OR t.tier = 1) AND NOT ${REPLIED}`,
  review: `t.status = 'done' AND t.handling = 'review'`,
  delegate: `t.status = 'done' AND t.handling = 'delegate'`,
  info: `t.status = 'done' AND t.handling = 'info'`,
  low: `t.status = 'done' AND (t.tier = 4 OR t.handling = 'none')`,
  all: '1',
  failed: `t.status = 'failed'`,
};

type ItemRow = MessageRow & { replied: number; thread_count: number; chased: number } & {
  [K in keyof TriageRow as `t_${K & string}`]: TriageRow[K] | null;
};
const TRIAGE_COLS = [
  'message_id',
  'member',
  'status',
  'attempts',
  'next_attempt_at',
  'source',
  'tier',
  'category',
  'handling',
  'why',
  'deadline',
  'asks',
  'reply_needed',
  'draft_decision',
  'delegate',
  'matter_id',
  'matter_confidence',
  'confidence',
  'safety_flag',
  'corrected',
  'model',
  'error',
  'triaged_at',
  'updated_at',
  'revision',
] as const;
const ITEM_SELECT = `SELECT m.*, ${TRIAGE_COLS.map((c) => `t.${c} AS t_${c}`).join(', ')},
  ${REPLIED} AS replied, ${THREAD} AS thread_count, ${CHASED} AS chased
  FROM mail_messages m LEFT JOIN mail_triage t ON t.message_id = m.id AND t.member = m.member`;

const importanceOf = (s: string): MailItem['importance'] => (s === 'low' || s === 'high' ? s : 'normal');

interface Extras {
  draft: DraftSummary | null;
  vip: boolean;
  meetingClash: string | null;
}

function toItem(r: ItemRow, x: Extras): MailItem {
  const t = r.t_status
    ? toTriage(Object.fromEntries(TRIAGE_COLS.map((c) => [c, r[`t_${c}`]])) as unknown as TriageRow)
    : null;
  return {
    id: r.id,
    conversationId: r.conversation_id,
    subject: r.subject,
    from: { name: r.from_name, address: r.from_address },
    to: addresses(r.to_json),
    cc: addresses(r.cc_json),
    receivedAt: r.received_at,
    preview: r.preview,
    hasAttachments: !!r.has_attachments,
    isRead: !!r.is_read,
    importance: importanceOf(r.importance),
    webLink: r.web_link,
    repliedByMe: !!r.replied,
    threadCount: Math.max(1, Number(r.thread_count) || 1),
    triage: t,
    draft: x.draft,
    vip: x.vip,
    chased: Math.max(0, Number(r.chased) || 0),
    meetingClash: x.meetingClash,
  };
}

// The merged effect of the active rules matching a message (sender beats domain beats subject).
export function matchRules(rules: MailRule[], from: string, subject: string) {
  const address = from.toLowerCase();
  const domain = domainOf(address);
  const s = subject.toLowerCase();
  const hits = rules.filter(
    (r) =>
      r.status === 'active' &&
      ((r.kind === 'sender' && r.pattern === address) ||
        (r.kind === 'domain' && !!domain && (domain === r.pattern || domain.endsWith('.' + r.pattern))) ||
        (r.kind === 'subject' && s.includes(r.pattern))),
  );
  if (!hits.length) return null;
  const order = { sender: 0, domain: 1, subject: 2 };
  hits.sort((a, b) => order[a.kind] - order[b.kind]);
  const effect: RuleEffect = {};
  for (const r of [...hits].reverse()) Object.assign(effect, r.effect);
  return { effect, kind: hits[0].kind };
}

// Whether the active rules mark this address (or its domain) as a VIP.
export const isVip = (rules: MailRule[], address: string) => !!matchRules(rules, address, '')?.effect.vip;

// Drafts, VIP marks and meeting clashes for a page of rows (a few queries per page, never per field).
async function extras(db: D1Database, member: string, rows: ItemRow[]) {
  const drafts = await latestDrafts(
    db,
    member,
    rows.map((x) => x.id),
  );
  const rules = await listRules(db, member, 'active');
  const out = new Map<string, Extras>();
  for (const r of rows) {
    const invite = Number(r.meeting_start) > 0 && Number(r.meeting_end) > 0;
    out.set(r.id, {
      draft: drafts.get(r.id) ?? null,
      vip: r.folder === 'inbox' && isVip(rules, r.from_address),
      meetingClash: invite
        ? await meetingClash(db, member, r.meeting_start!, r.meeting_end!, r.subject)
        : null,
    });
  }
  return out;
}

const normSubject = (s: string) =>
  s
    .toLowerCase()
    .replace(/^\s*((re|fw|fwd|updated|invitation|new time proposed)\s*:\s*)+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
// "h:mm am" in India time.
export const indiaClock = (ms: number) => {
  const d = new Date(ms + 330 * MINUTE);
  const h = d.getUTCHours();
  return `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};

// The busy meetings in my cached calendar that overlap an invitation, e.g. "Partners meeting, 11:30 am".
// The invitation's own tentative event (same times and subject) is not a clash.
export async function meetingClash(
  db: D1Database,
  member: string,
  start: number,
  end: number,
  subject: string,
): Promise<string | null> {
  const r = await db
    .prepare(
      `SELECT subject, start_at, end_at, all_day, response, show_as, cancelled FROM mail_events
       WHERE member = ? AND start_at < ? AND end_at > ? ORDER BY start_at LIMIT 20`,
    )
    .bind(member, end, start)
    .all<{
      subject: string;
      start_at: number;
      end_at: number;
      all_day: number;
      response: string;
      show_as: string;
      cancelled: number;
    }>();
  const own = normSubject(subject);
  const hits = r.results.filter(
    (e) =>
      !e.all_day &&
      isBusy({
        cancelled: !!e.cancelled,
        response: e.response as CalendarEvent['response'],
        showAs: e.show_as as CalendarEvent['showAs'],
      }) &&
      !(e.start_at === start && e.end_at === end && normSubject(e.subject) === own),
  );
  if (!hits.length) return null;
  const named = hits.slice(0, 2).map((e) => `${e.subject.slice(0, 80)}, ${indiaClock(e.start_at)}`);
  return named.join('; ') + (hits.length > 2 ? ` and ${hits.length - 2} more` : '');
}

async function latestDrafts(db: D1Database, member: string, ids: string[]) {
  const out = new Map<string, DraftSummary>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const r = await db
      .prepare(
        `SELECT id, message_id, status, placeholders, updated_at FROM mail_drafts WHERE member = ?
         AND status != 'discarded' AND message_id IN (${chunk.map(() => '?').join(',')})
         ORDER BY created_at DESC, rowid DESC`,
      )
      .bind(member, ...chunk)
      .all<{
        id: string;
        message_id: string;
        status: Draft['status'];
        placeholders: number;
        updated_at: number;
      }>();
    for (const d of r.results)
      if (!out.has(d.message_id))
        out.set(d.message_id, {
          id: d.id,
          status: d.status,
          placeholders: d.placeholders,
          updatedAt: d.updated_at,
        });
  }
  return out;
}

const likeWord = (w: string) => '%' + w.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
export const searchWords = (q: string) =>
  [
    ...new Set(
      q
        .toLowerCase()
        .split(/\s+/)
        .map((w) => w.trim())
        .filter(Boolean),
    ),
  ].slice(0, 8);

export async function listItems(
  db: D1Database,
  member: string,
  o: { view: MailView; search?: string; before?: number; limit: number; urgentFirst?: boolean },
) {
  const where = [`m.member = ?`, `m.folder = 'inbox'`, `m.removed_at IS NULL`, VIEW_WHERE[o.view]];
  const params: unknown[] = [member];
  for (const w of searchWords(o.search || '')) {
    where.push(
      `(lower(m.subject) LIKE ? ESCAPE '\\' OR lower(m.from_name) LIKE ? ESCAPE '\\' OR lower(m.from_address) LIKE ? ESCAPE '\\' OR lower(coalesce(t.why, '')) LIKE ? ESCAPE '\\')`,
    );
    const p = likeWord(w);
    params.push(p, p, p, p);
  }
  if (o.before) {
    where.push('m.received_at < ?');
    params.push(o.before);
  }
  const order = o.urgentFirst ? 'coalesce(t.tier, 3) ASC, m.received_at DESC' : 'm.received_at DESC';
  const r = await db
    .prepare(`${ITEM_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order}, m.id LIMIT ?`)
    .bind(...params, o.limit)
    .all<ItemRow>();
  const x = await extras(db, member, r.results);
  return r.results.map((row) => toItem(row, x.get(row.id)!));
}

export async function getItem(db: D1Database, member: string, id: string): Promise<MailMessage | null> {
  const r = await db
    .prepare(`${ITEM_SELECT} WHERE m.member = ? AND m.id = ?`)
    .bind(member, id)
    .first<ItemRow>();
  if (!r) return null;
  const x = await extras(db, member, [r]);
  return { ...toItem(r, x.get(id)!), bodyText: r.body_text };
}

// My most recent emails from or to any of these addresses (inbox and sent, archived ones included).
export async function itemsWith(db: D1Database, member: string, list: string[], limit: number) {
  const wanted = [...new Set(list.map((a) => a.trim().toLowerCase()).filter((a) => a.includes('@')))].slice(
    0,
    30,
  );
  if (!wanted.length) return [];
  const q = wanted.map(() => '?').join(',');
  const r = await db
    .prepare(
      `${ITEM_SELECT} WHERE m.member = ? AND ((m.folder = 'inbox' AND m.from_address IN (${q}))
       OR (m.folder = 'sent' AND (EXISTS (SELECT 1 FROM json_each(m.to_json) j WHERE lower(json_extract(j.value, '$.address')) IN (${q}))
       OR EXISTS (SELECT 1 FROM json_each(m.cc_json) j WHERE lower(json_extract(j.value, '$.address')) IN (${q})))))
       ORDER BY m.received_at DESC, m.id LIMIT ?`,
    )
    .bind(member, ...wanted, ...wanted, ...wanted, limit)
    .all<ItemRow>();
  const x = await extras(db, member, r.results);
  return r.results.map((row) => toItem(row, x.get(row.id)!));
}

export async function queueCounts(db: D1Database, member: string): Promise<QueueCounts> {
  const sum = (cond: string) => `coalesce(sum(CASE WHEN ${cond} THEN 1 ELSE 0 END), 0)`;
  const r = await db
    .prepare(
      `SELECT ${sum(VIEW_WHERE.needs_me)} AS needs_me, ${sum(VIEW_WHERE.review)} AS review,
       ${sum(VIEW_WHERE.delegate)} AS delegate, ${sum(VIEW_WHERE.info)} AS info, ${sum(VIEW_WHERE.low)} AS low,
       ${sum(VIEW_WHERE.failed)} AS failed, ${sum(`t.status = 'pending'`)} AS pending,
       ${sum(`t.status = 'done' AND t.tier = 1 AND NOT ${REPLIED}`)} AS urgent,
       ${sum(`t.status = 'done' AND t.reply_needed IN ('yes','maybe') AND t.draft_decision = 'undecided' AND NOT ${REPLIED}`)} AS decisions
       FROM mail_messages m LEFT JOIN mail_triage t ON t.message_id = m.id AND t.member = m.member
       WHERE m.member = ? AND m.folder = 'inbox' AND m.removed_at IS NULL`,
    )
    .bind(member)
    .first<Record<string, number>>();
  const d = await db
    .prepare("SELECT count(*) AS n FROM mail_drafts WHERE member = ? AND status IN ('draft','saved')")
    .bind(member)
    .first<{ n: number }>();
  const n = (k: string) => Number(r?.[k] ?? 0);
  return {
    needs_me: n('needs_me'),
    review: n('review'),
    delegate: n('delegate'),
    info: n('info'),
    low: n('low'),
    failed: n('failed'),
    pending: n('pending'),
    urgent: n('urgent'),
    draftsAwaiting: d?.n ?? 0,
    decisionsAwaiting: n('decisions'),
  };
}

// Drafts

export interface DraftRow {
  id: string;
  member: string;
  message_id: string;
  graph_draft_id: string | null;
  body: string;
  reply_all: number;
  to_json: string;
  cc_json: string;
  status: Draft['status'];
  placeholders: number;
  model: string;
  created_at: number;
  updated_at: number;
  sent_at: number | null;
  revision: number;
}

export const toDraft = (r: DraftRow): Draft => ({
  id: r.id,
  status: r.status,
  placeholders: r.placeholders,
  updatedAt: r.updated_at,
  messageId: r.message_id,
  body: r.body,
  replyAll: !!r.reply_all,
  to: addresses(r.to_json),
  cc: addresses(r.cc_json),
  outlookSaved: !!r.graph_draft_id && r.status !== 'sent' && r.status !== 'discarded',
  createdAt: r.created_at,
  sentAt: r.sent_at,
  revision: r.revision,
});

export async function loadDraft(db: D1Database, member: string, id: unknown) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(id)) return null;
  return db
    .prepare('SELECT * FROM mail_drafts WHERE member = ? AND id = ?')
    .bind(member, id)
    .first<DraftRow>();
}

// Rules

export interface RuleRow {
  id: string;
  member: string;
  kind: MailRule['kind'];
  pattern: string;
  effect: string;
  status: MailRule['status'];
  evidence: number;
  created_at: number;
  updated_at: number;
}

export const toRule = (r: RuleRow): MailRule => ({
  id: r.id,
  kind: r.kind,
  pattern: r.pattern,
  effect: json(r.effect, {}),
  status: r.status,
  evidence: r.evidence,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function listRules(db: D1Database, member: string, status?: MailRule['status']) {
  const r = await db
    .prepare(
      `SELECT * FROM mail_rules WHERE member = ?${status ? ' AND status = ?' : ''}
       ORDER BY CASE status WHEN 'proposed' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, updated_at DESC`,
    )
    .bind(...(status ? [member, status] : [member]))
    .all<RuleRow>();
  return r.results.map(toRule);
}
