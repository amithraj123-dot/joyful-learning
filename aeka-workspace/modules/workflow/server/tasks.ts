// Tasks (with maker-checker sign-off) and milestones.
import { CloudError } from '../../../lib/cloud-store.ts';
import type { Member } from '../../../core/server/members.ts';
import type { ModuleAction, ModuleContext } from '../../../core/server/module.ts';
import { SIGN_OFF_STATUSES, type Matter, type Milestone, type Task } from '../shared/types.ts';
import { conflict, insert, milestones, remove, saveRevision, tasks, write } from './db.ts';
import { loadPeople, type People } from './people.ts';
import {
  assertInsideWall,
  forbidden,
  isManager,
  managerOnly,
  me,
  visibleChild,
  visibleMatter,
} from './permissions.ts';
import { baseRevision, milestoneFields, obj, taskFields } from './validate.ts';

const mayEdit = (m: Member, task: Task, matter: Matter) =>
  isManager(m) || matter.team.includes(m.email) || task.assignee === m.email || task.createdBy === m.email;
const mayDelete = (m: Member, task: Task) => isManager(m) || task.createdBy === m.email;

// Validates a task and applies the sign-off rule. Assigning people never changes the matter team.
async function taskInput(ctx: ModuleContext, people: People, value: unknown, current?: Task) {
  const t = obj(value, 'task');
  const matter = await visibleMatter(ctx, t.matterId);
  const fields = taskFields(t);
  const was = current ? [current.assignee, current.preparedBy, current.reviewedBy] : [];
  const assignee = await people.optional(t.assignee, 'assignee', was);
  const preparedBy = await people.optional(t.preparedBy, 'preparer', was);
  const reviewedBy = await people.optional(t.reviewedBy, 'reviewer', was);
  const moved = current?.matterId !== matter.id;
  assertInsideWall(
    people,
    matter,
    [assignee, preparedBy, reviewedBy].filter((k) => moved || !was.includes(k)),
  );
  const signOffChanged =
    !current ||
    current.status !== fields.status ||
    current.preparedBy !== preparedBy ||
    current.reviewedBy !== reviewedBy;
  if (
    SIGN_OFF_STATUSES.includes(fields.status) &&
    preparedBy &&
    signOffChanged &&
    (!reviewedBy || reviewedBy === preparedBy)
  )
    throw new CloudError(
      `Before this task is marked "${fields.status}", it must be reviewed by someone other than its preparer.`,
    );
  const reviewedAt = !reviewedBy
    ? null
    : reviewedBy === current?.reviewedBy
      ? current.reviewedAt
      : ctx.now;
  return { matter, input: { ...fields, matterId: matter.id, assignee, preparedBy, reviewedBy, reviewedAt } };
}

async function findTask(ctx: ModuleContext, key: unknown, where = 'deleted_at IS NULL') {
  const { record, matter } = await visibleChild(ctx, tasks, key, 'task', where);
  return { task: record, matter };
}

async function milestoneInput(ctx: ModuleContext, value: unknown, current?: Milestone) {
  const m = obj(value, 'milestone');
  const matter = await visibleMatter(ctx, m.matterId);
  const people = await loadPeople(ctx.db);
  const owner = await people.optional(m.owner, 'owner', current ? [current.owner] : []);
  assertInsideWall(people, matter, [owner]);
  return { matter, input: { ...milestoneFields(m), matterId: matter.id, owner } };
}

export const taskActions: Record<string, ModuleAction> = {
  'task.create': {
    handler: async (ctx, p) => {
      const { matter, input } = await taskInput(ctx, await loadPeople(ctx.db), p.task);
      const task: Task = {
        id: crypto.randomUUID(),
        ...input,
        createdBy: me(ctx).email,
        createdAt: ctx.now,
        updatedAt: ctx.now,
        revision: 1,
        deletedAt: null,
      };
      await write(ctx.db, ctx.now, [insert(ctx.db, tasks, task)]);
      await ctx.log('task.created', task.id, `Created task "${task.title}" on ${matter.title}`);
      return task;
    },
  },
  'task.update': {
    handler: async (ctx, p) => {
      const { task: current, matter: from } = await findTask(ctx, p.id);
      if (!mayEdit(me(ctx), current, from))
        throw forbidden('You may edit tasks on your matters, tasks assigned to you and tasks you created.');
      const base = baseRevision(p);
      if (current.revision !== base) throw conflict('task');
      const { matter, input } = await taskInput(ctx, await loadPeople(ctx.db), p.task, current);
      const task = { ...current, ...input, revision: base + 1, updatedAt: ctx.now };
      await saveRevision(ctx.db, ctx.now, tasks, task, base, 'task');
      const summary =
        matter.id !== from.id
          ? `Moved task "${task.title}" from ${from.title} to ${matter.title}`
          : task.status !== current.status
            ? `Marked task "${task.title}" on ${matter.title} as ${task.status}`
            : `Updated task "${task.title}" on ${matter.title}`;
      await ctx.log('task.updated', task.id, summary);
      return task;
    },
  },
  'task.delete': {
    handler: async (ctx, p) => {
      const { task: current, matter } = await findTask(ctx, p.id);
      if (!mayDelete(me(ctx), current))
        throw forbidden('Only the creator of a task or a Manager and above can delete it.');
      const base = baseRevision(p);
      if (current.revision !== base) throw conflict('task');
      const task = { ...current, deletedAt: ctx.now, revision: base + 1, updatedAt: ctx.now };
      await saveRevision(ctx.db, ctx.now, tasks, task, base, 'task');
      await ctx.log('task.deleted', task.id, `Deleted task "${task.title}" on ${matter.title}`);
      return true;
    },
  },
  'task.restore': {
    handler: async (ctx, p) => {
      const { task: current, matter } = await findTask(ctx, p.id, 'deleted_at IS NOT NULL');
      if (!mayDelete(me(ctx), current))
        throw forbidden('Only the creator of a task or a Manager and above can restore it.');
      const task = { ...current, deletedAt: null, revision: current.revision + 1, updatedAt: ctx.now };
      await saveRevision(ctx.db, ctx.now, tasks, task, current.revision, 'task');
      await ctx.log('task.restored', task.id, `Restored task "${task.title}" on ${matter.title}`);
      return task;
    },
  },
  'milestone.create': {
    permission: managerOnly,
    handler: async (ctx, p) => {
      const { matter, input } = await milestoneInput(ctx, p.milestone);
      const milestone: Milestone = {
        id: crypto.randomUUID(),
        ...input,
        createdAt: ctx.now,
        updatedAt: ctx.now,
        revision: 1,
      };
      await write(ctx.db, ctx.now, [insert(ctx.db, milestones, milestone)]);
      await ctx.log(
        'milestone.created',
        milestone.id,
        `Added milestone "${milestone.title}" on ${matter.title}, due ${milestone.dueDate}`,
      );
      return milestone;
    },
  },
  'milestone.update': {
    permission: managerOnly,
    handler: async (ctx, p) => {
      const { record: current } = await visibleChild(ctx, milestones, p.id, 'milestone');
      const base = baseRevision(p);
      if (current.revision !== base) throw conflict('milestone');
      const { matter, input } = await milestoneInput(ctx, p.milestone, current);
      const milestone = { ...current, ...input, revision: base + 1, updatedAt: ctx.now };
      await saveRevision(ctx.db, ctx.now, milestones, milestone, base, 'milestone');
      await ctx.log('milestone.updated', milestone.id, `Updated milestone "${milestone.title}" on ${matter.title}`);
      return milestone;
    },
  },
  'milestone.delete': {
    permission: managerOnly,
    handler: async (ctx, p) => {
      const { record, matter } = await visibleChild(ctx, milestones, p.id, 'milestone');
      await write(ctx.db, ctx.now, [remove(ctx.db, milestones, record.id)]);
      await ctx.log('milestone.deleted', record.id, `Deleted milestone "${record.title}" on ${matter.title}`);
      return true;
    },
  },
};
