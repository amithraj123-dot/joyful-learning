// Agents tables: row shapes, mapping to the shared records, validation and the queries the actions
// share. Every query is scoped to one member's email, except the firm's templates.
import { CloudError } from '../../../lib/cloud-store.ts';
import type { ServerEnv } from '../../../core/server/env.ts';
import type { ModuleContext } from '../../../core/server/module.ts';
import { nextRun } from '../../assistant/server/services.ts';
import {
  EVENT_KINDS,
  SCHEDULE_REPEATS,
  type Agent,
  type AgentStatus,
  type Approval,
  type EventKind,
  type Lesson,
  type Run,
  type RunStep,
  type ScheduleRepeat,
  type Template,
  type Trigger,
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
export const LIMITS = {
  name: 80,
  instruction: 4000,
  contains: 100,
  notes: 2000,
  lesson: 300,
  comment: 1000,
  description: 400,
  agents: 30,
};

export const memberOf = (ctx: ModuleContext) => {
  if (!ctx.member) throw new CloudError('You do not have permission for this action.', 403);
  return ctx.member.email;
};
export const notFound = (label: string) => new CloudError(`This ${label} could not be found.`, 404);
export const conflict = (label: string) =>
  new CloudError(`This ${label} changed since you opened it. Reload and try again.`, 409);
export const bad = (message: string) => new CloudError(message);
const ID = /^[A-Za-z0-9_-]{1,80}$/;
export const idOf = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !ID.test(value)) throw notFound(label);
  return value;
};
export const newId = () => crypto.randomUUID().replace(/-/g, '');

export function text(value: unknown, label: string, max: number, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string') throw bad(`Enter ${label} as text.`);
  const s = value.trim();
  if (required && !s) throw bad(`Enter ${label}.`);
  if (s.length > max) throw bad(`Keep ${label} to ${max.toLocaleString('en-IN')} characters or fewer.`);
  return s;
}

const json = <T>(raw: unknown, fallback: T): T => {
  try {
    return typeof raw === 'string' && raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

// ---------- Triggers ----------

// Validates a trigger from the browser or the planner. A schedule's first run may be in the past: it
// then repeats from there (a "once" in the past is refused).
export function triggerOf(value: unknown, now: number): Trigger {
  const t = (value && typeof value === 'object' ? value : {}) as Row;
  if (t.type === 'manual') return { type: 'manual' };
  if (t.type === 'schedule') {
    if (!(SCHEDULE_REPEATS as readonly unknown[]).includes(t.repeat)) throw bad('Choose how often it runs.');
    const at = t.at;
    if (typeof at !== 'number' || !Number.isFinite(at) || at < now - 400 * DAY || at > now + 400 * DAY)
      throw bad('Choose when it first runs.');
    if (t.repeat === 'once' && at <= now) throw bad('That time has passed. Choose a time in the future.');
    return { type: 'schedule', repeat: t.repeat as ScheduleRepeat, at: Math.round(at / MINUTE) * MINUTE };
  }
  if (t.type === 'event') {
    const kinds = Array.isArray(t.kinds)
      ? [...new Set(t.kinds.filter((k): k is EventKind => (EVENT_KINDS as readonly unknown[]).includes(k)))]
      : [];
    if (!kinds.length) throw bad('Choose at least one thing that starts it.');
    return { type: 'event', kinds, contains: text(t.contains, 'the words to look for', LIMITS.contains) };
  }
  throw bad('Choose when the agent runs.');
}

// The next scheduled run after `now`, counted from the schedule's first run so a monthly one on the
// 31st keeps to the 31st.
export function nextRunAt(trigger: Trigger, now: number): number | null {
  if (trigger.type !== 'schedule') return null;
  if (trigger.at > now) return trigger.at;
  return nextRun(trigger.at, trigger.repeat, now).next;
}

// ---------- Records ----------

export interface Stats {
  runs: number;
  good: number;
  bad: number;
  approved: number;
  rejected: number;
}
const ZERO: Stats = { runs: 0, good: 0, bad: 0, approved: 0, rejected: 0 };

export const agentFrom = (r: Row): Agent => ({
  id: r.id as string,
  name: r.name as string,
  instruction: r.instruction as string,
  trigger: json<Trigger>(r.trigger_json, { type: 'manual' }),
  status: (r.status === 'active' ? 'active' : 'paused') as AgentStatus,
  notes: (r.notes as string) ?? '',
  templateId: (r.template_id as string | null) ?? null,
  nextRunAt: (r.next_run_at as number | null) ?? null,
  lastRunAt: (r.last_run_at as number | null) ?? null,
  stats: { ...ZERO, ...json<Partial<Stats>>(r.stats_json, {}) },
  monthlyLimit: Number(r.limit_calls ?? 300),
  usedThisMonth: 0, // filled in by the caller (usageThisMonth)
  createdAt: r.created_at as number,
  updatedAt: r.updated_at as number,
  revision: r.revision as number,
});

export const runFrom = (r: Row): Run => ({
  id: r.id as string,
  agentId: (r.agent_id as string | null) ?? null,
  agentName: r.agent_name as string,
  trigger: r.trigger as Run['trigger'],
  status: r.status as Run['status'],
  command: r.command as string,
  summary: (r.summary as string) ?? '',
  steps: json<RunStep[]>(r.steps_json, []),
  error: (r.error as string) ?? '',
  rating: (Number(r.rating) === 1 ? 1 : Number(r.rating) === -1 ? -1 : 0) as Run['rating'],
  feedback: (r.feedback as string) ?? '',
  startedAt: r.started_at as number,
  finishedAt: (r.finished_at as number | null) ?? null,
});

export const approvalFrom = (r: Row): Approval => ({
  id: r.id as string,
  agentId: (r.agent_id as string | null) ?? null,
  agentName: r.agent_name as string,
  runId: r.run_id as string,
  action: r.action as Approval['action'],
  title: r.title as string,
  detail: r.detail as string,
  reason: r.reason as string,
  link: r.link as string,
  status: r.status as Approval['status'],
  result: (r.result as string) ?? '',
  createdAt: r.created_at as number,
  decidedAt: (r.decided_at as number | null) ?? null,
});

export const lessonFrom = (r: Row): Lesson => ({
  id: r.id as string,
  agentId: (r.agent_id as string | null) ?? null,
  text: r.text as string,
  source: r.source as Lesson['source'],
  uses: Number(r.uses ?? 0),
  createdAt: r.created_at as number,
});

export const templateFrom = (r: Row): Template => ({
  id: r.id as string,
  name: r.name as string,
  description: r.description as string,
  instruction: r.instruction as string,
  trigger: json<Trigger>(r.trigger_json, { type: 'manual' }),
  author: r.author as string,
  authorName: r.author_name as string,
  copies: Number(r.copies ?? 0),
  createdAt: r.created_at as number,
});

export async function agentRow(db: D1Database, member: string, id: unknown) {
  const r = await db
    .prepare('SELECT * FROM ag_agents WHERE member = ? AND id = ?')
    .bind(member, idOf(id, 'agent'))
    .first<Row>();
  if (!r) throw notFound('agent');
  return r;
}

export async function runRow(db: D1Database, member: string, id: unknown) {
  const r = await db
    .prepare('SELECT * FROM ag_runs WHERE member = ? AND id = ?')
    .bind(member, idOf(id, 'run'))
    .first<Row>();
  if (!r) throw notFound('run');
  return r;
}

export async function listRuns(db: D1Database, member: string, agentId: string | null, limit: number) {
  const r = await db
    .prepare(
      `SELECT * FROM ag_runs WHERE member = ? ${agentId ? 'AND agent_id = ?' : ''} ORDER BY started_at DESC, rowid DESC LIMIT ?`,
    )
    .bind(...(agentId ? [member, agentId] : [member]), Math.min(Math.max(limit, 1), 100))
    .all<Row>();
  return r.results.map(runFrom);
}

// Adds to an agent's counters (runs, ratings, decisions).
export async function bumpStats(
  db: D1Database,
  member: string,
  agentId: string | null,
  change: Partial<Stats>,
) {
  if (!agentId) return;
  const r = await db
    .prepare('SELECT stats_json FROM ag_agents WHERE member = ? AND id = ?')
    .bind(member, agentId)
    .first<Row>();
  if (!r) return;
  const s = { ...ZERO, ...json<Partial<Stats>>(r.stats_json, {}) };
  for (const [k, v] of Object.entries(change))
    s[k as keyof Stats] = Math.max(0, s[k as keyof Stats] + (v ?? 0));
  await db
    .prepare('UPDATE ag_agents SET stats_json = ? WHERE member = ? AND id = ?')
    .bind(JSON.stringify(s), member, agentId)
    .run();
}

// ---------- Monthly AI limit ----------

// The start of this calendar month in India time.
export const monthStartIST = (now: number) => {
  const d = new Date(now + 330 * MINUTE);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - 330 * MINUTE;
};

// AI calls made this month by each of the member's agents (runs and what they learnt from).
export async function usageThisMonth(db: D1Database, member: string, now: number) {
  const r = await db
    .prepare(
      'SELECT agent_id, sum(ai_calls) AS n FROM ag_runs WHERE member = ? AND agent_id IS NOT NULL AND started_at >= ? GROUP BY agent_id',
    )
    .bind(member, monthStartIST(now))
    .all<{ agent_id: string; n: number }>();
  return new Map(r.results.map((x) => [x.agent_id, Number(x.n ?? 0)]));
}

export class LimitReached extends CloudError {
  constructor(name: string) {
    super(
      `"${name}" has used its AI calls for this month. Raise its monthly limit to run it again before the 1st.`,
      429,
    );
  }
}

export async function assertUnderLimit(db: D1Database, member: string, agentId: string, now: number) {
  const a = await db
    .prepare('SELECT name, limit_calls FROM ag_agents WHERE member = ? AND id = ?')
    .bind(member, agentId)
    .first<{ name: string; limit_calls: number }>();
  if (!a || !a.limit_calls) return;
  const used = (await usageThisMonth(db, member, now)).get(agentId) ?? 0;
  if (used >= a.limit_calls) throw new LimitReached(a.name);
}
