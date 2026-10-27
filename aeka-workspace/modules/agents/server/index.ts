// Agents server module: the actions of shared/contract.ts (tests check the two match) and the background
// work that starts scheduled and event agents. Every action works on the caller's own agents; templates
// are shared with the firm.
import { CloudError } from '../../../lib/cloud-store.ts';
import type { Member } from '../../../core/server/members.ts';
import type { ModuleAction, ModuleContext, ServerModule } from '../../../core/server/module.ts';
import { releaseLease, takeLease } from '../../../core/server/notifications.ts';
import { memberContext } from '../../assistant/server/context.ts';
import type { AgentStatus, ApprovalStatus, Trigger } from '../shared/types.ts';
import { decide, expireApprovals, listApprovals } from './approvals.ts';
import { addLesson, listLessons, reflect } from './learning.ts';
import { planCommand } from './planner.ts';
import { runAgent } from './runner.ts';
import {
  agentFrom,
  agentRow,
  approvalFrom,
  bad,
  bumpStats,
  conflict,
  idOf,
  LIMITS,
  listRuns,
  memberOf,
  MINUTE,
  newId,
  nextRunAt,
  runFrom,
  runRow,
  templateFrom,
  text,
  triggerOf,
  type Row,
  type Sys,
} from './store.ts';

// An event agent runs at most every 5 minutes (gathering what happened meanwhile into one run), and
// any agent at most 30 times a day.
const EVENT_GAP_MS = 5 * MINUTE;
const RUNS_PER_DAY = 30;
const RUNS_PER_TICK = 3;
const EVENTS_PER_RUN = 10;

const statusOf = (v: unknown): AgentStatus => {
  if (v !== 'active' && v !== 'paused') throw bad('Choose whether the agent is on or paused.');
  return v;
};

async function saveAgent(ctx: ModuleContext, p: Row) {
  const member = memberOf(ctx);
  const a = (p.agent && typeof p.agent === 'object' ? p.agent : null) as Row | null;
  if (!a) throw bad('Send the agent.');
  const name = text(a.name, 'a name', LIMITS.name, true);
  const instruction = text(a.instruction, 'what the agent should do', LIMITS.instruction, true);
  const trigger = triggerOf(a.trigger, ctx.now);
  const status = statusOf(a.status);
  const next = nextRunAt(trigger, ctx.now);
  if (p.id == null) {
    const count = await ctx.db
      .prepare('SELECT count(*) AS n FROM ag_agents WHERE member = ?')
      .bind(member)
      .first<{ n: number }>();
    if ((count?.n ?? 0) >= LIMITS.agents)
      throw new CloudError(`You have ${LIMITS.agents} agents, the most allowed. Delete one first.`, 409);
    const id = newId();
    await ctx.db
      .prepare(
        `INSERT INTO ag_agents(id,member,name,instruction,trigger_json,status,notes,template_id,next_run_at,event_cursor,last_run_at,stats_json,created_at,updated_at,revision)
         VALUES(?,?,?,?,?,?,'',NULL,?,?,NULL,'{}',?,?,1)`,
      )
      .bind(id, member, name, instruction, JSON.stringify(trigger), status, next, ctx.now, ctx.now, ctx.now)
      .run();
    await ctx.log('agent.created', id, `Created the agent "${name}"`);
    return agentFrom(await agentRow(ctx.db, member, id));
  }
  const current = await agentRow(ctx.db, member, p.id);
  const base = p.baseRevision;
  if (typeof base !== 'number' || !Number.isInteger(base)) throw bad('Reload and try again.');
  // Switching on, or changing what starts it, starts the event watch from now (nothing old replays).
  const restart =
    status === 'active' && (current.status !== 'active' || current.trigger_json !== JSON.stringify(trigger));
  const r = await ctx.db
    .prepare(
      `UPDATE ag_agents SET name = ?, instruction = ?, trigger_json = ?, status = ?, next_run_at = ?,
         event_cursor = CASE WHEN ? THEN ? ELSE event_cursor END, updated_at = ?, revision = revision + 1
       WHERE member = ? AND id = ? AND revision = ?`,
    )
    .bind(
      name,
      instruction,
      JSON.stringify(trigger),
      status,
      next,
      restart ? 1 : 0,
      ctx.now,
      ctx.now,
      member,
      current.id,
      base,
    )
    .run();
  if (!r.meta.changes) throw conflict('agent');
  return agentFrom(await agentRow(ctx.db, member, current.id));
}

const actions: Record<string, ModuleAction> = {
  'command.plan': { handler: (ctx, p) => planCommand(ctx, p.command) },
  'command.run': {
    handler: async (ctx, p) => {
      const command = text(p.command, 'what Aeka should do', LIMITS.instruction, true);
      return runAgent(ctx, {
        agent: { id: null, name: 'Command', instruction: command, notes: '' },
        trigger: 'command',
      });
    },
  },
  'agents.list': {
    handler: async (ctx) => {
      const member = memberOf(ctx);
      const r = await ctx.db
        .prepare('SELECT * FROM ag_agents WHERE member = ? ORDER BY status, name COLLATE NOCASE')
        .bind(member)
        .all<Row>();
      const pending = await ctx.db
        .prepare("SELECT count(*) AS n FROM ag_approvals WHERE member = ? AND status = 'pending'")
        .bind(member)
        .first<{ n: number }>();
      return { agents: r.results.map(agentFrom), pendingApprovals: pending?.n ?? 0 };
    },
  },
  'agent.get': {
    handler: async (ctx, p) => {
      const member = memberOf(ctx);
      const agent = agentFrom(await agentRow(ctx.db, member, p.id));
      return {
        agent,
        runs: await listRuns(ctx.db, member, agent.id, 20),
        lessons: (await listLessons(ctx.db, member, agent.id)).filter((l) => l.agentId === agent.id),
      };
    },
  },
  'agent.save': { handler: (ctx, p) => saveAgent(ctx, p) },
  'agent.run': {
    handler: async (ctx, p) => {
      const member = memberOf(ctx);
      const a = agentFrom(await agentRow(ctx.db, member, p.id));
      return runAgent(ctx, {
        agent: { id: a.id, name: a.name, instruction: a.instruction, notes: a.notes },
        trigger: 'manual',
      });
    },
  },
  'agent.clearNotes': {
    handler: async (ctx, p) => {
      const member = memberOf(ctx);
      const a = await agentRow(ctx.db, member, p.id);
      await ctx.db
        .prepare(
          "UPDATE ag_agents SET notes = '', updated_at = ?, revision = revision + 1 WHERE member = ? AND id = ?",
        )
        .bind(ctx.now, member, a.id)
        .run();
      return agentFrom(await agentRow(ctx.db, member, a.id));
    },
  },
  'agent.delete': {
    handler: async (ctx, p) => {
      const member = memberOf(ctx);
      const a = await agentRow(ctx.db, member, p.id);
      await ctx.db.batch([
        ctx.db.prepare('DELETE FROM ag_agents WHERE member = ? AND id = ?').bind(member, a.id),
        ctx.db.prepare('DELETE FROM ag_lessons WHERE member = ? AND agent_id = ?').bind(member, a.id),
        ctx.db
          .prepare(
            "UPDATE ag_approvals SET status = 'expired', result = 'The agent was deleted.', decided_at = ? WHERE member = ? AND agent_id = ? AND status = 'pending'",
          )
          .bind(ctx.now, member, a.id),
      ]);
      await ctx.log('agent.deleted', a.id as string, `Deleted the agent "${a.name as string}"`);
      return true;
    },
  },
  'runs.list': {
    handler: async (ctx, p) => {
      const member = memberOf(ctx);
      const agentId = p.agentId == null ? null : idOf(p.agentId, 'agent');
      const limit = typeof p.limit === 'number' && Number.isInteger(p.limit) ? p.limit : 20;
      return listRuns(ctx.db, member, agentId, limit);
    },
  },
  'run.get': {
    handler: async (ctx, p) => {
      const member = memberOf(ctx);
      const run = runFrom(await runRow(ctx.db, member, p.id));
      const r = await ctx.db
        .prepare('SELECT * FROM ag_approvals WHERE member = ? AND run_id = ? ORDER BY created_at')
        .bind(member, run.id)
        .all<Row>();
      return { run, approvals: r.results.map(approvalFrom) };
    },
  },
  'run.feedback': {
    handler: async (ctx, p) => {
      const member = memberOf(ctx);
      const row = await runRow(ctx.db, member, p.id);
      if (p.rating !== 1 && p.rating !== -1) throw bad('Rate the run good or poor.');
      const comment = text(p.comment, 'the comment', LIMITS.comment);
      const before = Number(row.rating ?? 0);
      await ctx.db
        .prepare('UPDATE ag_runs SET rating = ?, feedback = ? WHERE member = ? AND id = ?')
        .bind(p.rating, comment, member, row.id)
        .run();
      const agentId = (row.agent_id as string | null) ?? null;
      await bumpStats(ctx.db, member, agentId, {
        good: (p.rating === 1 ? 1 : 0) - (before === 1 ? 1 : 0),
        bad: (p.rating === -1 ? 1 : 0) - (before === -1 ? 1 : 0),
      });
      const run = runFrom(await runRow(ctx.db, member, row.id));
      const lessons = await reflect(ctx, member, run, { kind: 'rating', rating: p.rating, comment });
      return { run, lessons };
    },
  },
  'approvals.list': {
    handler: async (ctx, p) => {
      const status = p.status as ApprovalStatus | undefined;
      if (status != null && !['pending', 'approved', 'rejected', 'failed', 'expired'].includes(status))
        throw bad('Choose a valid status.');
      return listApprovals(ctx.db, memberOf(ctx), status);
    },
  },
  'approval.decide': { handler: (ctx, p) => decide(ctx, p.id, p.approve, p.reason) },
  'lessons.list': {
    handler: async (ctx, p) =>
      listLessons(ctx.db, memberOf(ctx), p.agentId == null ? null : idOf(p.agentId, 'agent')),
  },
  'lesson.save': {
    handler: async (ctx, p) => {
      const member = memberOf(ctx);
      const agentId = p.agentId == null ? null : ((await agentRow(ctx.db, member, p.agentId)).id as string);
      const t = text(p.text, 'the lesson', LIMITS.lesson, true);
      const l = await addLesson(ctx.db, member, agentId, t, 'member', ctx.now);
      if (!l) throw new CloudError('That lesson is already there.', 409);
      return l;
    },
  },
  'lesson.delete': {
    handler: async (ctx, p) => {
      const r = await ctx.db
        .prepare('DELETE FROM ag_lessons WHERE member = ? AND id = ?')
        .bind(memberOf(ctx), idOf(p.id, 'lesson'))
        .run();
      if (!r.meta.changes) throw new CloudError('This lesson could not be found.', 404);
      return true;
    },
  },
  'templates.list': {
    handler: async (ctx) => {
      memberOf(ctx);
      const r = await ctx.db
        .prepare('SELECT * FROM ag_templates ORDER BY copies DESC, created_at DESC LIMIT 200')
        .bind()
        .all<Row>();
      return r.results.map(templateFrom);
    },
  },
  'template.publish': {
    handler: async (ctx, p) => {
      const member = memberOf(ctx);
      const m = ctx.member!;
      if (m.designation !== 'Partner' && !m.isAdmin)
        throw new CloudError('Only Partners and administrators publish firm templates.', 403);
      const a = agentFrom(await agentRow(ctx.db, member, p.agentId));
      const description = text(p.description, 'a description', LIMITS.description, true);
      const id = newId();
      await ctx.db
        .prepare(
          'INSERT INTO ag_templates(id,author,author_name,name,description,instruction,trigger_json,copies,created_at) VALUES(?,?,?,?,?,?,?,0,?)',
        )
        .bind(id, member, m.name, a.name, description, a.instruction, JSON.stringify(a.trigger), ctx.now)
        .run();
      await ctx.log('template.published', id, `Published the agent template "${a.name}"`);
      return templateFrom(
        (await ctx.db.prepare('SELECT * FROM ag_templates WHERE id = ?').bind(id).first<Row>())!,
      );
    },
  },
  'template.copy': {
    handler: async (ctx, p) => {
      const member = memberOf(ctx);
      const t = await ctx.db
        .prepare('SELECT * FROM ag_templates WHERE id = ?')
        .bind(idOf(p.id, 'template'))
        .first<Row>();
      if (!t) throw new CloudError('This template could not be found.', 404);
      const tpl = templateFrom(t);
      // A schedule in the past starts from its next occurrence; a past one-off becomes on command.
      let trigger: Trigger = tpl.trigger;
      if (trigger.type === 'schedule' && trigger.repeat === 'once' && trigger.at <= ctx.now)
        trigger = { type: 'manual' };
      const agent = await saveAgent(ctx, {
        agent: { name: tpl.name, instruction: tpl.instruction, trigger, status: 'paused' },
      });
      await ctx.db.batch([
        ctx.db
          .prepare('UPDATE ag_agents SET template_id = ? WHERE member = ? AND id = ?')
          .bind(tpl.id, member, agent.id),
        ctx.db.prepare('UPDATE ag_templates SET copies = copies + 1 WHERE id = ?').bind(tpl.id),
      ]);
      return agentFrom(await agentRow(ctx.db, member, agent.id));
    },
  },
  'template.delete': {
    handler: async (ctx, p) => {
      const member = memberOf(ctx);
      const t = await ctx.db
        .prepare('SELECT author FROM ag_templates WHERE id = ?')
        .bind(idOf(p.id, 'template'))
        .first<Row>();
      if (!t) throw new CloudError('This template could not be found.', 404);
      if (t.author !== member && !ctx.member!.isAdmin)
        throw new CloudError('Only its author or an administrator can delete a template.', 403);
      await ctx.db.prepare('DELETE FROM ag_templates WHERE id = ?').bind(p.id).run();
      return true;
    },
  },
};

// ---------- Background: schedules and events ----------

const dayStartIST = (now: number) => {
  const d = new Date(now + 330 * MINUTE);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 330 * MINUTE;
};

async function underDailyCap(sys: Sys, member: string, agentId: string) {
  const r = await sys.db
    .prepare('SELECT count(*) AS n FROM ag_runs WHERE member = ? AND agent_id = ? AND started_at >= ?')
    .bind(member, agentId, dayStartIST(sys.now))
    .first<{ n: number }>();
  return (r?.n ?? 0) < RUNS_PER_DAY;
}

// What starts an event agent: the member's notices of the chosen kinds since the last look, which
// mention the chosen words. Chat notices are passed by their title only (a chat kept from AI may have
// its text in the notice body).
async function newEvents(sys: Sys, member: string, row: Row, trigger: Extract<Trigger, { type: 'event' }>) {
  const r = await sys.db
    .prepare(
      `SELECT kind, title, body, created_at FROM org_notifications WHERE recipient = ? AND created_at > ? AND created_at <= ?
       AND kind IN (SELECT value FROM json_each(?)) ORDER BY created_at LIMIT 50`,
    )
    .bind(member, Number(row.event_cursor ?? 0), sys.now, JSON.stringify(trigger.kinds))
    .all<{ kind: string; title: string; body: string; created_at: number }>();
  const words = trigger.contains.toLowerCase();
  const matched = r.results.filter((n) => !words || `${n.title} ${n.body}`.toLowerCase().includes(words));
  const cursor = r.results.length
    ? r.results[r.results.length - 1].created_at
    : Number(row.event_cursor ?? 0);
  return {
    cursor,
    events: matched.slice(0, EVENTS_PER_RUN).map((n) => ({
      kind: n.kind,
      title: n.title,
      body: n.kind.startsWith('chats.') ? '' : n.body,
      at: n.created_at,
    })),
  };
}

export async function agentsPass(sys: Sys, member: Member) {
  const lease = `agents:${member.email}`;
  if (!(await takeLease(sys.db, lease, sys.now, 10 * MINUTE))) return 0;
  let ran = 0;
  try {
    await expireApprovals(sys, member.email);
    const ctx = memberContext(sys, member);
    const rows = (
      await sys.db
        .prepare(
          "SELECT * FROM ag_agents WHERE member = ? AND status = 'active' ORDER BY coalesce(last_run_at, 0)",
        )
        .bind(member.email)
        .all<Row>()
    ).results;
    for (const row of rows) {
      if (ran >= RUNS_PER_TICK) break;
      const agent = agentFrom(row);
      const t = agent.trigger;
      if (t.type === 'schedule') {
        if (agent.nextRunAt == null || agent.nextRunAt > sys.now) continue;
        // Move the schedule on first, so a slow or failed run never repeats.
        const next = t.repeat === 'once' ? null : nextRunAt(t, sys.now);
        await sys.db
          .prepare(
            `UPDATE ag_agents SET next_run_at = ?, status = CASE WHEN ? IS NULL THEN 'paused' ELSE status END WHERE member = ? AND id = ? AND next_run_at = ?`,
          )
          .bind(next, next, member.email, agent.id, agent.nextRunAt)
          .run();
        if (!(await underDailyCap(sys, member.email, agent.id))) continue;
        await runAgent(ctx, { agent: { ...agent }, trigger: 'schedule' });
        ran++;
      } else if (t.type === 'event') {
        if (agent.lastRunAt != null && sys.now - agent.lastRunAt < EVENT_GAP_MS) continue;
        const { cursor, events } = await newEvents(sys, member.email, row, t);
        if (cursor !== Number(row.event_cursor ?? 0))
          await sys.db
            .prepare('UPDATE ag_agents SET event_cursor = ? WHERE member = ? AND id = ?')
            .bind(cursor, member.email, agent.id)
            .run();
        if (!events.length || !(await underDailyCap(sys, member.email, agent.id))) continue;
        await runAgent(ctx, { agent: { ...agent }, trigger: 'event', events });
        ran++;
      }
    }
  } finally {
    await releaseLease(sys.db, lease);
  }
  return ran;
}

export const agentsServer: ServerModule = {
  id: 'agents',
  actions,
  tick: async (sys, { member }) => {
    if (!member?.active) return;
    await agentsPass(sys, member);
  },
};
