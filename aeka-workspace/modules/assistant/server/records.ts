// Personal to-dos, reminders and memory. Every query is filtered by the caller's email, so another
// member's id is simply not found. These records are private: nothing here is written to the firm
// activity trail (todo.toTask records only the firm task it creates).
import { CloudError } from '../../../lib/cloud-store.ts';
import type { ModuleContext } from '../../../core/server/module.ts';
import { createTaskFor } from '../../workflow/server/services.ts';
import type { MemoryInput, ReminderInput, TodoInput } from '../shared/contract.ts';
import {
  MEMORY_CATEGORIES,
  REPEATS,
  type Memory,
  type Reminder,
  type Todo,
  type TodoSource,
} from '../shared/types.ts';
import {
  LIMITS,
  bad,
  conflict,
  int,
  looksSecret,
  notFound,
  obj,
  oneOf,
  optionalTime,
  owner,
  recordId,
  text,
  time,
} from './validate.ts';

type Row = Record<string, unknown>;
const SKEW = 60000; // a reminder may be up to a minute in the past when created (clock skew)

// ---------- To-dos ----------

const todoFrom = (r: Row): Todo => ({
  id: r.id as string,
  title: r.title as string,
  details: r.details as string,
  status: r.status as Todo['status'],
  priority: r.priority as Todo['priority'],
  dueAt: (r.due_at as number | null) ?? null,
  source: r.source as TodoSource,
  sourceRef: r.source_ref as string,
  // A to-do being moved holds a short claim ("claim:<time>:<id>"), never shown as a task.
  taskId: typeof r.task_id === 'string' && !r.task_id.startsWith('claim:') ? r.task_id : null,
  createdAt: r.created_at as number,
  updatedAt: r.updated_at as number,
  doneAt: (r.done_at as number | null) ?? null,
  revision: r.revision as number,
});

export function todoFields(value: unknown): TodoInput {
  const t = obj(value, 'to-do');
  return {
    title: text(t.title, 'a title', LIMITS.title, true),
    details: text(t.details, 'the details', LIMITS.details),
    priority: t.priority == null ? 'normal' : oneOf(t.priority, ['normal', 'high'] as const, 'priority'),
    dueAt: optionalTime(t.dueAt, 'due date and time'),
    status: t.status == null ? 'open' : oneOf(t.status, ['open', 'done'] as const, 'status'),
  };
}

export async function getTodo(ctx: ModuleContext, id: unknown) {
  const key = recordId(id, 'to-do');
  const r = await ctx.db
    .prepare('SELECT * FROM as_todos WHERE id = ? AND member = ?')
    .bind(key, owner(ctx))
    .first<Row>();
  if (!r) throw notFound('to-do');
  return todoFrom(r);
}

export async function listTodos(ctx: ModuleContext, includeDone = false) {
  const r = await ctx.db
    .prepare(
      `SELECT * FROM as_todos WHERE member = ?${includeDone ? '' : " AND status = 'open'"}
       ORDER BY status = 'done', due_at IS NULL, due_at, created_at DESC LIMIT 1000`,
    )
    .bind(owner(ctx))
    .all<Row>();
  return r.results.map(todoFrom);
}

async function assertOpenRoom(ctx: ModuleContext) {
  const r = await ctx.db
    .prepare("SELECT count(*) AS n FROM as_todos WHERE member = ? AND status = 'open'")
    .bind(owner(ctx))
    .first<{ n: number }>();
  if ((r?.n ?? 0) >= LIMITS.openTodos)
    throw new CloudError(
      `You have ${LIMITS.openTodos} open to-dos, the most allowed. Complete or delete some first.`,
      409,
    );
}

export async function createTodo(
  ctx: ModuleContext,
  input: TodoInput,
  source: TodoSource = 'manual',
  sourceRef = '',
) {
  const status = input.status ?? 'open';
  if (status === 'open') await assertOpenRoom(ctx);
  const todo: Todo = {
    id: crypto.randomUUID(),
    title: input.title,
    details: input.details,
    status,
    priority: input.priority,
    dueAt: input.dueAt,
    source,
    sourceRef: sourceRef.slice(0, 200),
    taskId: null,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    doneAt: status === 'done' ? ctx.now : null,
    revision: 1,
  };
  await ctx.db
    .prepare(
      'INSERT INTO as_todos(id,member,title,details,status,priority,due_at,source,source_ref,task_id,created_at,updated_at,done_at,revision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    )
    .bind(
      todo.id,
      owner(ctx),
      todo.title,
      todo.details,
      todo.status,
      todo.priority,
      todo.dueAt,
      todo.source,
      todo.sourceRef,
      null,
      todo.createdAt,
      todo.updatedAt,
      todo.doneAt,
      1,
    )
    .run();
  return todo;
}

export async function updateTodo(ctx: ModuleContext, id: unknown, input: TodoInput, base: number) {
  const current = await getTodo(ctx, id);
  const status = input.status ?? current.status;
  if (status === 'open' && current.status !== 'open') await assertOpenRoom(ctx);
  const doneAt = status === 'done' ? (current.doneAt ?? ctx.now) : null;
  const r = await ctx.db
    .prepare(
      'UPDATE as_todos SET title = ?, details = ?, priority = ?, due_at = ?, status = ?, done_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND member = ? AND revision = ?',
    )
    .bind(
      input.title,
      input.details,
      input.priority,
      input.dueAt,
      status,
      doneAt,
      ctx.now,
      current.id,
      owner(ctx),
      base,
    )
    .run();
  if (!r.meta.changes) throw conflict('to-do');
  return getTodo(ctx, current.id);
}

export async function completeTodo(ctx: ModuleContext, id: unknown) {
  const t = await getTodo(ctx, id);
  if (t.status === 'done') return t;
  return updateTodo(ctx, t.id, { ...t, status: 'done' }, t.revision);
}

export async function deleteTodo(ctx: ModuleContext, id: unknown) {
  const key = recordId(id, 'to-do');
  const r = await ctx.db
    .prepare('DELETE FROM as_todos WHERE id = ? AND member = ?')
    .bind(key, owner(ctx))
    .run();
  if (!r.meta.changes) throw notFound('to-do');
  return true as const;
}

// Moves a to-do onto a mandate as a Workflow task. The to-do is claimed first, so two requests at once
// cannot create two tasks; the claim is released if the task cannot be created.
export async function todoToTask(ctx: ModuleContext, p: Record<string, unknown>) {
  const todo = await getTodo(ctx, p.id);
  if (todo.taskId) throw new CloudError('This to-do has already been moved to a task.', 409);
  // A claim older than two minutes was left by a request that did not finish.
  if (todo.status !== 'open') throw new CloudError('Only an open to-do can be moved to a task.', 409);
  if (typeof p.matterId !== 'string' || !p.matterId) throw bad('Choose a mandate.');
  if (p.assignee != null && typeof p.assignee !== 'string') throw bad('Choose a valid assignee.');
  const claim = `claim:${ctx.now}:${crypto.randomUUID()}`;
  const claimed = await ctx.db
    .prepare(
      "UPDATE as_todos SET task_id = ? WHERE id = ? AND member = ? AND status = 'open' AND (task_id IS NULL OR (task_id LIKE 'claim:%' AND task_id < ?))",
    )
    .bind(claim, todo.id, owner(ctx), `claim:${ctx.now - 120000}`)
    .run();
  if (!claimed.meta.changes) throw conflict('to-do');
  let taskId: string;
  try {
    const task = await createTaskFor(
      ctx,
      {
        matterId: p.matterId,
        title: todo.title,
        assignee: (p.assignee as string | null) ?? null,
        dueDate: (p.dueDate as string | null) ?? null,
        notes: todo.details,
      },
      'from a to-do',
    );
    taskId = task.id;
  } catch (e) {
    await ctx.db
      .prepare('UPDATE as_todos SET task_id = NULL WHERE id = ? AND member = ? AND task_id = ?')
      .bind(todo.id, owner(ctx), claim)
      .run();
    throw e;
  }
  await ctx.db
    .prepare(
      "UPDATE as_todos SET task_id = ?, status = 'done', done_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND member = ? AND task_id = ?",
    )
    .bind(taskId, ctx.now, ctx.now, todo.id, owner(ctx), claim)
    .run();
  return { todo: await getTodo(ctx, todo.id), taskId };
}

// ---------- Reminders ----------

const reminderFrom = (r: Row): Reminder => ({
  id: r.id as string,
  title: r.title as string,
  dueAt: r.due_at as number,
  repeat: r.repeat as Reminder['repeat'],
  status: r.status as Reminder['status'],
  lastFiredAt: (r.last_fired_at as number | null) ?? null,
  createdAt: r.created_at as number,
  updatedAt: r.updated_at as number,
  revision: r.revision as number,
});

export function reminderFields(value: unknown): ReminderInput {
  const r = obj(value, 'reminder');
  return {
    title: text(r.title, 'a title', LIMITS.title, true),
    dueAt: time(r.dueAt, 'reminder time'),
    repeat: r.repeat == null ? 'once' : oneOf(r.repeat, REPEATS, 'repeat'),
    status: r.status == null ? 'active' : oneOf(r.status, ['active', 'paused'] as const, 'status'),
  };
}

const assertFuture = (ctx: ModuleContext, dueAt: number) => {
  if (dueAt < ctx.now - SKEW) throw bad('Choose a reminder time in the future.');
};

export async function getReminder(ctx: ModuleContext, id: unknown) {
  const key = recordId(id, 'reminder');
  const r = await ctx.db
    .prepare('SELECT * FROM as_reminders WHERE id = ? AND member = ?')
    .bind(key, owner(ctx))
    .first<Row>();
  if (!r) throw notFound('reminder');
  return reminderFrom(r);
}

export async function listReminders(ctx: ModuleContext) {
  const r = await ctx.db
    .prepare(
      "SELECT * FROM as_reminders WHERE member = ? ORDER BY status = 'done', due_at LIMIT 1000",
    )
    .bind(owner(ctx))
    .all<Row>();
  return r.results.map(reminderFrom);
}

async function assertReminderRoom(ctx: ModuleContext) {
  const r = await ctx.db
    .prepare("SELECT count(*) AS n FROM as_reminders WHERE member = ? AND status = 'active'")
    .bind(owner(ctx))
    .first<{ n: number }>();
  if ((r?.n ?? 0) >= LIMITS.activeReminders)
    throw new CloudError(
      `You have ${LIMITS.activeReminders} active reminders, the most allowed. Delete or pause some first.`,
      409,
    );
}

export async function createReminder(ctx: ModuleContext, input: ReminderInput) {
  assertFuture(ctx, input.dueAt);
  const status = input.status ?? 'active';
  if (status === 'active') await assertReminderRoom(ctx);
  const reminder: Reminder = {
    id: crypto.randomUUID(),
    title: input.title,
    dueAt: input.dueAt,
    repeat: input.repeat,
    status,
    lastFiredAt: null,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    revision: 1,
  };
  await ctx.db
    .prepare(
      'INSERT INTO as_reminders(id,member,title,due_at,repeat,status,last_fired_at,created_at,updated_at,revision) VALUES(?,?,?,?,?,?,?,?,?,?)',
    )
    .bind(
      reminder.id,
      owner(ctx),
      reminder.title,
      reminder.dueAt,
      reminder.repeat,
      reminder.status,
      null,
      ctx.now,
      ctx.now,
      1,
    )
    .run();
  return reminder;
}

export async function updateReminder(ctx: ModuleContext, id: unknown, input: ReminderInput, base: number) {
  const current = await getReminder(ctx, id);
  const status = input.status ?? 'active';
  // A new time, or reactivating, needs a time in the future; a renamed reminder keeps its time.
  if (input.dueAt !== current.dueAt || (status === 'active' && current.status !== 'active'))
    assertFuture(ctx, input.dueAt);
  if (status === 'active' && current.status !== 'active') await assertReminderRoom(ctx);
  const r = await ctx.db
    .prepare(
      'UPDATE as_reminders SET title = ?, due_at = ?, repeat = ?, status = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND member = ? AND revision = ?',
    )
    .bind(input.title, input.dueAt, input.repeat, status, ctx.now, current.id, owner(ctx), base)
    .run();
  if (!r.meta.changes) throw conflict('reminder');
  return getReminder(ctx, current.id);
}

export async function snoozeReminder(ctx: ModuleContext, id: unknown, minutes: unknown, base?: number) {
  const m = int(minutes, 'the snooze in minutes', 5, 10080);
  const current = await getReminder(ctx, id);
  if (current.status !== 'active') await assertReminderRoom(ctx);
  const r = await ctx.db
    .prepare(
      "UPDATE as_reminders SET due_at = ?, status = 'active', updated_at = ?, revision = revision + 1 WHERE id = ? AND member = ? AND revision = ?",
    )
    .bind(ctx.now + m * 60000, ctx.now, current.id, owner(ctx), base ?? current.revision)
    .run();
  if (!r.meta.changes) throw conflict('reminder');
  return getReminder(ctx, current.id);
}

export async function deleteReminder(ctx: ModuleContext, id: unknown) {
  const key = recordId(id, 'reminder');
  const r = await ctx.db
    .prepare('DELETE FROM as_reminders WHERE id = ? AND member = ?')
    .bind(key, owner(ctx))
    .run();
  if (!r.meta.changes) throw notFound('reminder');
  return true as const;
}

// ---------- Memory ----------

const memoryFrom = (r: Row): Memory => ({
  id: r.id as string,
  category: r.category as Memory['category'],
  title: r.title as string,
  content: r.content as string,
  createdAt: r.created_at as number,
  updatedAt: r.updated_at as number,
});

export function memoryFields(value: unknown): MemoryInput {
  const m = obj(value, 'memory');
  const input = {
    category: oneOf(m.category, MEMORY_CATEGORIES, 'category'),
    title: text(m.title, 'a title', LIMITS.title, true),
    content: text(m.content, 'what to remember', LIMITS.memoryContent, true),
  };
  if (looksSecret(input.title + ' ' + input.content))
    throw bad('Memory is not a safe place for passwords, PINs or card numbers. Keep them in a password manager.');
  return input;
}

export async function listMemory(ctx: ModuleContext, limit = LIMITS.memories) {
  const r = await ctx.db
    .prepare('SELECT * FROM as_memory WHERE member = ? ORDER BY updated_at DESC, rowid DESC LIMIT ?')
    .bind(owner(ctx), limit)
    .all<Row>();
  return r.results.map(memoryFrom);
}

export async function getMemory(ctx: ModuleContext, id: unknown) {
  const r = await ctx.db
    .prepare('SELECT * FROM as_memory WHERE id = ? AND member = ?')
    .bind(recordId(id, 'memory'), owner(ctx))
    .first<Row>();
  if (!r) throw notFound('memory');
  return memoryFrom(r);
}

export async function saveMemory(ctx: ModuleContext, id: unknown, input: MemoryInput) {
  if (id != null) {
    const current = await getMemory(ctx, id);
    await ctx.db
      .prepare(
        'UPDATE as_memory SET category = ?, title = ?, content = ?, updated_at = ? WHERE id = ? AND member = ?',
      )
      .bind(input.category, input.title, input.content, ctx.now, current.id, owner(ctx))
      .run();
    return getMemory(ctx, current.id);
  }
  const count = await ctx.db
    .prepare('SELECT count(*) AS n FROM as_memory WHERE member = ?')
    .bind(owner(ctx))
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= LIMITS.memories)
    throw new CloudError(`You have ${LIMITS.memories} memories, the most allowed. Delete some first.`, 409);
  const memory: Memory = { id: crypto.randomUUID(), ...input, createdAt: ctx.now, updatedAt: ctx.now };
  await ctx.db
    .prepare(
      'INSERT INTO as_memory(id,member,category,title,content,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
    )
    .bind(memory.id, owner(ctx), memory.category, memory.title, memory.content, ctx.now, ctx.now)
    .run();
  return memory;
}

export async function deleteMemory(ctx: ModuleContext, id: unknown) {
  const key = recordId(id, 'memory');
  const r = await ctx.db
    .prepare('DELETE FROM as_memory WHERE id = ? AND member = ?')
    .bind(key, owner(ctx))
    .run();
  if (!r.meta.changes) throw notFound('memory');
  return true as const;
}

