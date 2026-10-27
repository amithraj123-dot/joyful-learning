// Chats tables: row shapes, mapping to the shared records and the queries the actions share. Every
// query is scoped to one member's email; no query reads another member's rows.
import { CloudError } from '../../../lib/cloud-store.ts';
import type { ServerEnv } from '../../../core/server/env.ts';
import type { ModuleContext } from '../../../core/server/module.ts';
import {
  APPS,
  CATEGORIES,
  DEFAULT_SETTINGS,
  TIERS,
  type AppId,
  type Category,
  type ChatDraft,
  type ChatMessage,
  type ChatSettings,
  type ChatThread,
  type ChatView,
  type PhoneDevice,
  type QueueCounts,
  type ReplyNeeded,
  type Tier,
  type TriageSource,
  type TriageStatus,
} from '../shared/types.ts';

export interface Sys {
  db: D1Database;
  env: ServerEnv;
  fetch: typeof fetch;
  now: number;
}
export type Row = Record<string, unknown>;

export const MINUTE = 60000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const KEEP_MS = 30 * DAY; // messages are deleted after 30 days
export const RECENT_MS = 14 * DAY; // the views show chats active in the last 14 days

export const memberOf = (ctx: ModuleContext) => {
  if (!ctx.member) throw new CloudError('You do not have permission for this action.', 403);
  return ctx.member.email;
};
export const notFound = (label: string) => new CloudError(`This ${label} could not be found.`, 404);
export const conflict = (label: string) =>
  new CloudError(`This ${label} changed since you opened it. Reload and try again.`, 409);
export const bad = (message: string) => new CloudError(message);

const ID = /^[A-Za-z0-9_-]{1,80}$/;
export const idOf = (value: unknown, label = 'chat') => {
  if (typeof value !== 'string' || !ID.test(value)) throw notFound(label);
  return value;
};
export const isApp = (v: unknown): v is AppId => (APPS as readonly unknown[]).includes(v);
export const isTier = (v: unknown): v is Tier => (TIERS as readonly unknown[]).includes(v);
export const isCategory = (v: unknown): v is Category => (CATEGORIES as readonly unknown[]).includes(v);
export const isReplyNeeded = (v: unknown): v is ReplyNeeded => v === 'yes' || v === 'no' || v === 'maybe';
export const baseRevision = (p: Row) => {
  const r = p.baseRevision;
  if (typeof r !== 'number' || !Number.isInteger(r) || r < 0) throw bad('Reload and try again.');
  return r;
};

// ---------- Settings ----------

export function settingsFrom(json: string | null | undefined): ChatSettings {
  let raw: Record<string, unknown> = {};
  try {
    raw = json ? (JSON.parse(json) as Record<string, unknown>) : {};
  } catch {
    raw = {};
  }
  const apps = { ...DEFAULT_SETTINGS.apps };
  const given = raw.apps && typeof raw.apps === 'object' ? (raw.apps as Record<string, unknown>) : {};
  for (const a of APPS) if (typeof given[a] === 'boolean') apps[a] = given[a] as boolean;
  const flag = (k: 'nudges' | 'quietHours' | 'ai') =>
    typeof raw[k] === 'boolean' ? (raw[k] as boolean) : DEFAULT_SETTINGS[k];
  return { apps, nudges: flag('nudges'), quietHours: flag('quietHours'), ai: flag('ai') };
}

export async function loadSettings(db: D1Database, member: string) {
  const r = await db
    .prepare('SELECT settings_json FROM ch_settings WHERE member = ?')
    .bind(member)
    .first<{ settings_json: string }>();
  return settingsFrom(r?.settings_json);
}

export async function saveSettings(db: D1Database, member: string, s: ChatSettings, now: number) {
  await db
    .prepare(
      'INSERT INTO ch_settings(member,settings_json,updated_at) VALUES(?,?,?) ON CONFLICT(member) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at',
    )
    .bind(member, JSON.stringify(s), now)
    .run();
  return s;
}

// ---------- Threads ----------

// The SQL conditions behind ChatThread.needsMe, for a thread row t and the time ?.
export const NEEDS_ME = `t.muted = 0 AND t.last_in_at IS NOT NULL AND t.reply_needed IN ('yes','maybe')
  AND t.triage_status IN ('done','pending')
  AND (t.last_out_at IS NULL OR t.last_out_at < t.last_in_at)
  AND (t.done_at IS NULL OR t.done_at < t.last_in_at)
  AND (t.snoozed_until IS NULL OR t.snoozed_until <= ?)`;

export function threadFrom(r: Row, now: number): ChatThread {
  const lastInAt = (r.last_in_at as number | null) ?? null;
  const lastOutAt = (r.last_out_at as number | null) ?? null;
  const doneAt = (r.done_at as number | null) ?? null;
  const snoozed = (r.snoozed_until as number | null) ?? null;
  const answered = lastOutAt != null && (lastInAt == null || lastOutAt >= lastInAt);
  const done = doneAt != null && (lastInAt == null || doneAt >= lastInAt);
  const tier = (isTier(r.tier) ? r.tier : 3) as Tier;
  const replyNeeded = isReplyNeeded(r.reply_needed) ? r.reply_needed : 'no';
  const status = r.triage_status as TriageStatus;
  const triaged = status !== 'none';
  const muted = !!r.muted;
  return {
    id: r.id as string,
    app: (isApp(r.app) ? r.app : 'whatsapp') as AppId,
    chat: r.chat_key as string,
    title: r.title as string,
    group: !!r.is_group,
    address: (r.address as string) ?? '',
    lastIn:
      lastInAt == null
        ? null
        : { at: lastInAt, sender: r.last_in_sender as string, text: r.last_in_text as string },
    lastOutAt,
    waitingSince: answered ? null : ((r.waiting_since as number | null) ?? null),
    unanswered: answered ? 0 : Number(r.unanswered ?? 0),
    seenAt: (r.seen_at as number | null) ?? null,
    snoozedUntil: snoozed != null && snoozed > now ? snoozed : null,
    done,
    muted,
    neverAi: !!r.never_ai,
    vip: !!r.vip,
    needsMe:
      !muted &&
      lastInAt != null &&
      (status === 'done' || status === 'pending') &&
      replyNeeded !== 'no' &&
      !answered &&
      !done &&
      !(snoozed != null && snoozed > now),
    live: !!r.live,
    triage: triaged
      ? {
          status,
          source: (r.triage_source as TriageSource) ?? 'rules',
          tier,
          category: (isCategory(r.category) ? r.category : 'unknown') as Category,
          replyNeeded,
          summary: (r.summary as string) ?? '',
          why: (r.why as string) ?? '',
          replyBy: (r.reply_by as string | null) ?? null,
        }
      : null,
    nudges: answered ? 0 : Number(r.nudge_level ?? 0),
    updatedAt: r.updated_at as number,
    revision: r.revision as number,
  };
}

export async function loadThread(db: D1Database, member: string, id: string) {
  return db.prepare('SELECT * FROM ch_threads WHERE member = ? AND id = ?').bind(member, id).first<Row>();
}

export async function getThread(ctx: ModuleContext, id: unknown) {
  const member = memberOf(ctx);
  const r = await loadThread(ctx.db, member, idOf(id));
  if (!r) throw notFound('chat');
  return { member, row: r, thread: threadFrom(r, ctx.now) };
}

export async function listThreads(
  db: D1Database,
  member: string,
  now: number,
  o: { view: ChatView; app?: AppId; search?: string; limit?: number },
) {
  const where: string[] = ['t.member = ?'];
  const binds: unknown[] = [member];
  const recent = now - RECENT_MS;
  switch (o.view) {
    case 'needs':
      where.push(NEEDS_ME);
      binds.push(now);
      break;
    case 'waiting':
      where.push(
        't.muted = 0 AND t.is_group = 0 AND t.last_out_at IS NOT NULL AND (t.last_in_at IS NULL OR t.last_out_at >= t.last_in_at) AND (t.done_at IS NULL OR t.done_at < t.last_out_at) AND t.last_out_at >= ?',
      );
      binds.push(now - 7 * DAY);
      break;
    case 'low':
      where.push(
        "t.muted = 0 AND (t.tier = 4 OR t.reply_needed = 'no') AND t.triage_status = 'done' AND t.last_in_at >= ?",
      );
      binds.push(recent);
      break;
    case 'muted':
      where.push('t.muted = 1');
      break;
    default:
      where.push('t.muted = 0 AND coalesce(t.last_in_at, t.last_out_at, t.created_at) >= ?');
      binds.push(recent);
  }
  if (o.app) {
    where.push('t.app = ?');
    binds.push(o.app);
  }
  if (o.search) {
    where.push("(lower(t.title) LIKE ? ESCAPE '\\' OR lower(t.last_in_text) LIKE ? ESCAPE '\\')");
    const like = `%${o.search.toLowerCase().replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    binds.push(like, like);
  }
  const order =
    o.view === 'needs'
      ? 't.tier ASC, coalesce(t.waiting_since, t.last_in_at) ASC'
      : o.view === 'waiting'
        ? 't.last_out_at DESC'
        : 'coalesce(t.last_in_at, t.last_out_at, t.created_at) DESC';
  const r = await db
    .prepare(`SELECT t.* FROM ch_threads t WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`)
    .bind(...binds, Math.min(Math.max(o.limit ?? 50, 1), 100))
    .all<Row>();
  return r.results.map((x) => threadFrom(x, now));
}

export async function queueCounts(db: D1Database, member: string, now: number): Promise<QueueCounts> {
  const r = await db
    .prepare(
      `SELECT
        sum(CASE WHEN ${NEEDS_ME} THEN 1 ELSE 0 END) AS needs,
        sum(CASE WHEN t.muted = 0 AND t.is_group = 0 AND t.last_out_at IS NOT NULL AND (t.last_in_at IS NULL OR t.last_out_at >= t.last_in_at) AND (t.done_at IS NULL OR t.done_at < t.last_out_at) AND t.last_out_at >= ? THEN 1 ELSE 0 END) AS waiting,
        sum(CASE WHEN t.muted = 0 AND (t.tier = 4 OR t.reply_needed = 'no') AND t.triage_status = 'done' AND t.last_in_at >= ? THEN 1 ELSE 0 END) AS low,
        sum(CASE WHEN t.muted = 0 AND t.triage_status = 'pending' THEN 1 ELSE 0 END) AS pending
       FROM ch_threads t WHERE t.member = ?`,
    )
    .bind(now, now - 7 * DAY, now - RECENT_MS, member)
    .first<Record<string, number | null>>();
  return { needs: r?.needs ?? 0, waiting: r?.waiting ?? 0, low: r?.low ?? 0, pending: r?.pending ?? 0 };
}

// ---------- Messages and drafts ----------

export async function threadMessages(db: D1Database, member: string, threadId: string, limit = 100) {
  const r = await db
    .prepare(
      'SELECT * FROM (SELECT * FROM ch_messages WHERE member = ? AND thread_id = ? ORDER BY at DESC, rowid DESC LIMIT ?) ORDER BY at ASC',
    )
    .bind(member, threadId, limit)
    .all<Row>();
  return r.results.map((m): ChatMessage => ({
    id: m.id as string,
    sender: m.sender as string,
    fromMe: !!m.from_me,
    text: m.text as string,
    at: m.at as number,
  }));
}

export const draftFrom = (r: Row): ChatDraft => ({
  id: r.id as string,
  threadId: r.thread_id as string,
  text: r.text as string,
  status: r.status as ChatDraft['status'],
  how: (r.how as ChatDraft['how']) ?? null,
  createdAt: r.created_at as number,
  updatedAt: r.updated_at as number,
  sentAt: (r.sent_at as number | null) ?? null,
  revision: r.revision as number,
});

export async function openDraft(db: D1Database, member: string, threadId: string) {
  const r = await db
    .prepare(
      "SELECT * FROM ch_drafts WHERE member = ? AND thread_id = ? AND status = 'draft' ORDER BY created_at DESC LIMIT 1",
    )
    .bind(member, threadId)
    .first<Row>();
  return r ? draftFrom(r) : null;
}

// ---------- Devices ----------

export const deviceFrom = (r: Row): PhoneDevice => {
  let access: PhoneDevice['access'] = null;
  try {
    const a = r.access_json ? (JSON.parse(r.access_json as string) as Record<string, unknown>) : null;
    if (a)
      access = {
        notifications: a.notifications === true,
        postNotifications: a.postNotifications === true,
        batteryUnrestricted: a.batteryUnrestricted === true,
      };
  } catch {
    access = null;
  }
  return {
    id: r.id as string,
    name: r.name as string,
    model: r.model as string,
    appVersion: r.app_version as string,
    android: Number(r.android ?? 0),
    createdAt: r.created_at as number,
    lastSeenAt: (r.last_seen_at as number | null) ?? null,
    access,
  };
};

export async function listDevices(db: D1Database, member: string) {
  const r = await db
    .prepare('SELECT * FROM ch_devices WHERE member = ? AND revoked_at IS NULL ORDER BY created_at DESC')
    .bind(member)
    .all<Row>();
  return r.results.map(deviceFrom);
}

// Hex SHA-256 of a string.
export async function sha256(value: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// India time label, e.g. "28 Oct, 4:05 pm".
export function indiaTime(ms: number) {
  const d = new Date(ms + 330 * MINUTE);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]}, ${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

// "2 hours", "35 minutes", "3 days".
export function waitLabel(ms: number) {
  if (ms < HOUR) {
    const m = Math.max(1, Math.round(ms / MINUTE));
    return `${m} minute${m === 1 ? '' : 's'}`;
  }
  if (ms < 2 * DAY) {
    const h = Math.round(ms / HOUR);
    return `${h} hour${h === 1 ? '' : 's'}`;
  }
  const d = Math.round(ms / DAY);
  return `${d} days`;
}
