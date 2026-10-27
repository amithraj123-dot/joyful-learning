// The approval queue: what an agent proposes to do outside the member's own records waits here for one
// tap. Approving carries it out as the member, with every check the same action has in its own module
// (Mail's Send checks, Workflow's task rules and ethical walls). Rejecting teaches the agent.
import { CloudError } from '../../../lib/cloud-store.ts';
import type { ModuleContext } from '../../../core/server/module.ts';
import { notify } from '../../../core/server/notifications.ts';
import { draftForApproval, sendApprovedDraft } from '../../mail/server/service.ts';
import { changeTask, createTaskFor, matterTargets, taskSummary } from '../../workflow/server/services.ts';
import { TASK_STATUSES } from '../../workflow/shared/types.ts';
import type { Approval, ApprovalAction, Lesson } from '../shared/types.ts';
import { reflect } from './learning.ts';
import {
  approvalFrom,
  bad,
  bumpStats,
  DAY,
  idOf,
  memberOf,
  newId,
  notFound,
  runFrom,
  type Row,
  type Sys,
} from './store.ts';

export const EXPIRE_MS = 7 * DAY;
const MAX_PENDING = 50;

export interface SendEmail {
  draftId: string;
}
export interface CreateTask {
  matterId: string;
  title: string;
  assignee: string | null;
  dueDate: string | null;
  notes: string;
}

export interface UpdateTask {
  taskId: string;
  status?: (typeof TASK_STATUSES)[number];
  dueDate?: string;
  assignee?: string | null;
}

export interface Proposal {
  action: ApprovalAction;
  payload: SendEmail | CreateTask | UpdateTask;
  title: string;
  detail: string;
  link: string;
}

// Checks what an agent proposes and describes it for the member. Throws a message the agent can report.
export async function describe(ctx: ModuleContext, action: ApprovalAction, p: Row): Promise<Proposal> {
  if (action === 'send_email') {
    const draftId = typeof p.draftId === 'string' ? p.draftId : '';
    const d = draftId ? await draftForApproval(ctx, draftId) : null;
    if (!d)
      throw new CloudError(
        'There is no such email draft waiting to be sent. Prepare one with draft_email_reply first.',
      );
    if (d.placeholders > 0 || /\[INPUT REQUIRED/i.test(d.body))
      throw new CloudError(
        'The draft still has [INPUT REQUIRED] items, so it cannot be sent. Tell the member to complete it in Mail > Drafts.',
      );
    return {
      action,
      payload: { draftId: d.id },
      title:
        `Send the email to ${d.to.join(', ') || '(no recipient)'}${d.subject ? `: ${d.subject}` : ''}`.slice(
          0,
          300,
        ),
      detail: d.body.slice(0, 4000),
      link: 'mail/drafts',
    };
  }
  if (action === 'update_task') {
    const taskId = typeof p.taskId === 'string' ? p.taskId : '';
    let t;
    try {
      t = await taskSummary(ctx, taskId);
    } catch {
      throw new CloudError(
        'There is no such Workflow task that the member can see. Use my_work for task ids.',
      );
    }
    const change: UpdateTask = { taskId: t.id };
    const what: string[] = [];
    if (p.status != null) {
      if (!(TASK_STATUSES as readonly unknown[]).includes(p.status))
        throw new CloudError(`The status must be one of: ${TASK_STATUSES.join(', ')}.`);
      if (p.status !== t.status) {
        change.status = p.status as UpdateTask['status'];
        what.push(`status from ${t.status} to ${p.status as string}`);
      }
    }
    if (p.dueDate != null) {
      if (typeof p.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.dueDate))
        throw new CloudError('Give the due date as YYYY-MM-DD.');
      if (p.dueDate !== t.dueDate) {
        change.dueDate = p.dueDate;
        what.push(`due date from ${t.dueDate ?? 'none'} to ${p.dueDate}`);
      }
    }
    if (p.assignee != null) {
      const to = typeof p.assignee === 'string' && p.assignee.trim() ? p.assignee.trim().toLowerCase() : null;
      if (to !== t.assignee) {
        change.assignee = to;
        what.push(to ? `assign it to ${to}` : 'unassign it');
      }
    }
    if (!what.length) throw new CloudError('Nothing would change on this task.');
    return {
      action,
      payload: change,
      title: `Update the task "${t.title}" on ${t.matterTitle}`.slice(0, 300),
      detail: `Change the ${what.join('; ')}.`
        .replace('Change the assign', 'Assign')
        .replace('Change the unassign', 'Unassign'),
      link: `workflow/matters#${t.matterId}`,
    };
  }
  const matterId = typeof p.mandateId === 'string' ? p.mandateId : '';
  const target = (await matterTargets(ctx)).find((t) => t.matterId === matterId);
  if (!target) throw new CloudError('There is no such mandate that the member can see. Use list_mandates.');
  const title = typeof p.title === 'string' ? p.title.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
  if (!title) throw new CloudError('Give the task a title.');
  const assignee =
    typeof p.assignee === 'string' && p.assignee.trim() ? p.assignee.trim().toLowerCase() : null;
  const dueDate = typeof p.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.dueDate) ? p.dueDate : null;
  const notes = typeof p.notes === 'string' ? p.notes.trim().slice(0, 2000) : '';
  return {
    action,
    payload: { matterId, title, assignee, dueDate, notes },
    title: `Create the task "${title}" on ${target.clientName}, ${target.title}`.slice(0, 300),
    detail: [
      assignee ? `Assigned to ${assignee}.` : 'Not assigned to anyone.',
      dueDate ? `Due ${dueDate}.` : 'No due date.',
      notes,
    ]
      .filter(Boolean)
      .join('\n'),
    link: `workflow/matters#${matterId}`,
  };
}

// Queues a proposal (one pending approval per email draft) and tells the member.
export async function propose(
  sys: Sys,
  member: string,
  agent: { id: string | null; name: string },
  runId: string,
  proposal: Proposal,
  reason: string,
) {
  const pending = await sys.db
    .prepare("SELECT payload_json, action FROM ag_approvals WHERE member = ? AND status = 'pending'")
    .bind(member)
    .all<Row>();
  if (pending.results.length >= MAX_PENDING)
    throw new CloudError('Too many approvals are waiting for the member already. Report instead.');
  if (
    proposal.action === 'send_email' &&
    pending.results.some(
      (r) =>
        r.action === 'send_email' &&
        (JSON.parse(r.payload_json as string) as SendEmail).draftId ===
          (proposal.payload as SendEmail).draftId,
    )
  )
    throw new CloudError('Sending this draft is already waiting for the member to approve.');
  const id = newId();
  await sys.db
    .prepare(
      `INSERT INTO ag_approvals(id,member,agent_id,agent_name,run_id,action,payload_json,title,detail,reason,link,status,result,created_at,decided_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending','',?,NULL)`,
    )
    .bind(
      id,
      member,
      agent.id,
      agent.name,
      runId,
      proposal.action,
      JSON.stringify(proposal.payload),
      proposal.title,
      proposal.detail,
      reason.slice(0, 500),
      proposal.link,
      sys.now,
    )
    .run();
  await notify(
    sys.db,
    {
      recipient: member,
      module: 'agents',
      kind: 'agent.approval',
      title: `Approve? ${proposal.title}`.slice(0, 200),
      body: `${agent.name}: ${reason}`.slice(0, 600),
      link: 'agents/home',
      dedupeKey: `agent.approval:${id}`,
    },
    sys.now,
  );
  return id;
}

export async function listApprovals(db: D1Database, member: string, status?: string) {
  const r = await db
    .prepare(
      `SELECT * FROM ag_approvals WHERE member = ? ${status ? 'AND status = ?' : ''} ORDER BY created_at DESC, rowid DESC LIMIT 100`,
    )
    .bind(...(status ? [member, status] : [member]))
    .all<Row>();
  return r.results.map(approvalFrom);
}

export async function expireApprovals(sys: Sys, member: string) {
  await sys.db
    .prepare(
      "UPDATE ag_approvals SET status = 'expired', decided_at = ?, result = 'Not decided within 7 days.' WHERE member = ? AND status = 'pending' AND created_at < ?",
    )
    .bind(sys.now, member, sys.now - EXPIRE_MS)
    .run();
}

// Approves (carries the action out) or rejects (and learns from it). Decided once only.
export async function decide(
  ctx: ModuleContext,
  id: unknown,
  approve: unknown,
  reason: unknown,
): Promise<{ approval: Approval; lessons: Lesson[] }> {
  const member = memberOf(ctx);
  if (typeof approve !== 'boolean') throw bad('Choose approve or reject.');
  if (reason != null && (typeof reason !== 'string' || reason.length > 1000))
    throw bad('Keep the reason to 1,000 characters or fewer.');
  const row = await ctx.db
    .prepare('SELECT * FROM ag_approvals WHERE member = ? AND id = ?')
    .bind(member, idOf(id, 'approval'))
    .first<Row>();
  if (!row) throw notFound('approval');
  if (row.status !== 'pending') throw new CloudError('This was already decided.', 409);
  // Claim it first, so a double tap never carries the action out twice.
  const claim = await ctx.db
    .prepare(
      "UPDATE ag_approvals SET status = ?, decided_at = ? WHERE member = ? AND id = ? AND status = 'pending'",
    )
    .bind(approve ? 'approved' : 'rejected', ctx.now, member, row.id)
    .run();
  if (!claim.meta.changes) throw new CloudError('This was already decided.', 409);
  const agentId = (row.agent_id as string | null) ?? null;
  let lessons: Lesson[] = [];
  let status = approve ? 'approved' : 'rejected';
  let result = '';
  if (approve) {
    try {
      const payload = JSON.parse(row.payload_json as string) as Row;
      if (row.action === 'send_email') {
        await sendApprovedDraft(ctx, payload.draftId as string);
        result = 'Sent from your mailbox.';
      } else if (row.action === 'update_task') {
        const p = payload as unknown as UpdateTask;
        const { taskId, ...changes } = p;
        const task = await changeTask(ctx, taskId, changes);
        result = `Task updated: ${task.title} (${task.status}${task.dueDate ? `, due ${task.dueDate}` : ''}).`;
      } else {
        const p = payload as unknown as CreateTask;
        const task = await createTaskFor(
          ctx,
          { matterId: p.matterId, title: p.title, assignee: p.assignee, dueDate: p.dueDate, notes: p.notes },
          `by the agent "${row.agent_name as string}", approved`,
        );
        result = `Task created: ${task.title}.`;
      }
      await bumpStats(ctx.db, member, agentId, { approved: 1 });
    } catch (e) {
      status = 'failed';
      result =
        e instanceof CloudError ? e.message : 'It could not be carried out because of an internal error.';
    }
  } else {
    const why = typeof reason === 'string' ? reason.trim() : '';
    result = why ? `Rejected: ${why}` : 'Rejected.';
    await bumpStats(ctx.db, member, agentId, { rejected: 1 });
    const run = await ctx.db
      .prepare('SELECT * FROM ag_runs WHERE member = ? AND id = ?')
      .bind(member, row.run_id)
      .first<Row>();
    if (run)
      lessons = await reflect(ctx, member, runFrom(run), {
        kind: 'rejected',
        what: row.title as string,
        reason: why,
      });
  }
  await ctx.db
    .prepare('UPDATE ag_approvals SET status = ?, result = ? WHERE member = ? AND id = ?')
    .bind(status, result.slice(0, 1000), member, row.id)
    .run();
  const fresh = await ctx.db
    .prepare('SELECT * FROM ag_approvals WHERE member = ? AND id = ?')
    .bind(member, row.id)
    .first<Row>();
  return { approval: approvalFrom(fresh!), lessons };
}
