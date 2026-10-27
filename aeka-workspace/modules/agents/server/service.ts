// What other modules may read from Agents: actions waiting for my approval (for the brief).
import type { ModuleContext } from '../../../core/server/module.ts';
import { listApprovals } from './approvals.ts';

export async function approvalsWaiting(ctx: ModuleContext, limit = 8) {
  const email = ctx.member?.email;
  if (!email) return [];
  return (await listApprovals(ctx.db, email, 'pending')).slice(0, limit).map((a) => ({
    title: a.title,
    agentName: a.agentName,
  }));
}
