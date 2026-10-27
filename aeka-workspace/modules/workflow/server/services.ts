// Workflow's services for other modules (assistant, mail). They apply the same visibility and task
// rules as Workflow's own actions; other modules never read Workflow tables directly.
import type { ModuleContext } from '../../../core/server/module.ts';
import type { MeetingTarget, Milestone, PersonKey, Task } from '../shared/types.ts';
import { all, clients, milestones, tasks, write } from './db.ts';
import { loadPeople } from './people.ts';
import { me, visibleMatter, visibleMatters } from './permissions.ts';
import { newTask, notifyAssignee } from './tasks.ts';

// Live mandates the caller can see, with client names, sorted by client then title.
export async function matterTargets(ctx: ModuleContext): Promise<MeetingTarget[]> {
  const names = new Map((await all(ctx.db, clients, 'deleted_at IS NULL')).map((c) => [c.id, c.name]));
  return (await visibleMatters(ctx))
    .filter((m) => names.has(m.clientId))
    .map((m) => ({
      matterId: m.id,
      title: m.title,
      clientName: names.get(m.clientId)!,
      status: m.status,
      restricted: m.restricted,
    }))
    .sort((a, b) => a.clientName.localeCompare(b.clientName) || a.title.localeCompare(b.title));
}

// Open tasks assigned to the caller on mandates they can see, with the mandate label.
export async function myOpenTasks(ctx: ModuleContext): Promise<(Task & { matterLabel: string })[]> {
  const targets = new Map((await matterTargets(ctx)).map((t) => [t.matterId, t]));
  return (
    await all(ctx.db, tasks, "deleted_at IS NULL AND assignee = ? AND status != 'Completed'", me(ctx).email)
  )
    .filter((t) => targets.has(t.matterId))
    .map((t) => {
      const m = targets.get(t.matterId)!;
      return { ...t, matterLabel: `${m.clientName}: ${m.title}` };
    })
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
}

// Open tasks on one mandate the caller can see (everyone's, not only the caller's), soonest due first.
export async function openTasksOn(ctx: ModuleContext, matterId: string): Promise<Task[]> {
  const matter = await visibleMatter(ctx, matterId);
  return (
    await all(ctx.db, tasks, "deleted_at IS NULL AND matter_id = ? AND status != 'Completed'", matter.id)
  ).sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
}

// Open deadlines on visible mandates due on or before `until` (YYYY-MM-DD), with the mandate label.
export async function upcomingDeadlines(ctx: ModuleContext, until: string) {
  const targets = new Map((await matterTargets(ctx)).map((t) => [t.matterId, t]));
  return (await all(ctx.db, milestones, 'done = 0 AND due_date <= ?', until))
    .filter((m) => targets.has(m.matterId))
    .map((m: Milestone) => {
      const t = targets.get(m.matterId)!;
      return { ...m, matterLabel: `${t.clientName}: ${t.title}` };
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

// Creates a task on a mandate the caller can see, with the usual task rules, and records it.
export async function createTaskFor(
  ctx: ModuleContext,
  input: {
    matterId: string;
    title: string;
    assignee: PersonKey | null;
    dueDate: string | null;
    notes?: string;
  },
  origin: string, // e.g. "from an email", for the activity trail
) {
  await visibleMatter(ctx, input.matterId);
  const { task, matter, statement } = await newTask(ctx, await loadPeople(ctx.db), {
    matterId: input.matterId,
    title: input.title,
    status: 'Preparing',
    assignee: input.assignee,
    preparedBy: null,
    reviewedBy: null,
    dueDate: input.dueDate,
    priority: false,
    notes: input.notes ?? '',
    steps: [],
  });
  await write(ctx.db, ctx.now, [statement]);
  await ctx.log('task.created', task.id, `Created task "${task.title}" on ${matter.title} ${origin}`);
  await notifyAssignee(ctx, task, matter);
  return task;
}
