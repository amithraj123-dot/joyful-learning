// What other modules may read from Agents: actions waiting for my approval (for the brief).
import type { ModuleContext } from '../../../core/server/module.ts';
import { listApprovals } from './approvals.ts';
import { planCommand, triggerLabel } from './planner.ts';
import { agentFrom, nextRunAt, type Row } from './store.ts';

export async function approvalsWaiting(ctx: ModuleContext, limit = 8) {
  const email = ctx.member?.email;
  if (!email) return [];
  return (await listApprovals(ctx.db, email, 'pending')).slice(0, limit).map((a) => ({
    title: a.title,
    agentName: a.agentName,
  }));
}

// Creates an agent from a plain-text command, switched on (for Ask Aeka and WhatsApp: "every Friday at
// 4 pm, ..."). The member sees and changes it in Agents.
export async function createAgentFromCommand(ctx: ModuleContext, command: string) {
  const plan = await planCommand(ctx, command);
  const { agentsServer } = await import('./index.ts');
  const agent = (await agentsServer.actions['agent.save'].handler(ctx, {
    agent: { name: plan.name, instruction: plan.instruction, trigger: plan.trigger, status: 'active' },
  })) as ReturnType<typeof agentFrom>;
  return {
    id: agent.id,
    name: agent.name,
    when: triggerLabel(agent.trigger),
    nextRunAt: agent.nextRunAt,
    explanation: plan.explanation,
  };
}

// My agents in brief, for Ask Aeka.
export async function agentsInBrief(ctx: ModuleContext) {
  const email = ctx.member?.email;
  if (!email) return [];
  const r = await ctx.db
    .prepare('SELECT * FROM ag_agents WHERE member = ? ORDER BY name COLLATE NOCASE LIMIT 30')
    .bind(email)
    .all<Row>();
  return r.results.map(agentFrom).map((a) => ({
    name: a.name,
    status: a.status,
    when: triggerLabel(a.trigger),
    nextRunAt: a.trigger.type === 'schedule' ? nextRunAt(a.trigger, ctx.now) : null,
    lastRunAt: a.lastRunAt,
  }));
}
