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
  TODO_REPEATS,
  type Memory,
  type Reminder,
  type Todo,
  type TodoRepeat,
  type TodoSource,
} from '../shared/types.ts';
import { QUICK_ADD_MAX, parseQuickAdd } from './quickadd.ts';
import { DAY, nextOccurrence } from './recurrence.ts';
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

// A deleted to-do that came from another module (an email, a commitment, a meeting) is kept as a hidden
// tombstone, so that the same item is not added again. Its task_id holds this marker.
const DISMISSED = 'dismissed:';
// The next to-do of a repeating one carries "repeat:<previous id>" as its source_ref, so a completion
// creates at most one successor; the API shows it as no source reference.
const REPEAT_REF = 'repeat:';
export const STALE_AFTER = 7 * DAY;
export const CRITICAL_AFTER = 3 * DAY;
const OPEN = "status IN ('open','doing')";
const VISIBLE = `(task_id IS NULL OR task_id NOT LIKE '${DISMISSED}%')`;

export const todoFrom = (r: Row, now: number): Todo => {
  const status = r.status as Todo['status'];
  const dueAt = (r.due_at as number | null) ?? null;
  const sourceRef = r.source_ref as string;
  return {
    id: r.id as string,
    title: r.title as string,
    details: r.details as string,
    status,
    priority: r.priority as Todo['priority'],
    dueAt,
    source: r.source as TodoSource,
    sourceRef: sourceRef.startsWith(REPEAT_REF) ? '' : sourceRef,
    sourceLabel: (r.source_label as string) ?? '',
    list: (r.list as string) ?? '',
    repeat: TODO_REPEATS.includes(r.repeat as TodoRepeat) ? (r.repeat as TodoRepeat) : 'none',
    stale: status !== 'done' && dueAt == null && now - (r.created_at as number) > STALE_AFTER,
    critical: status !== 'done' && dueAt != null && now - dueAt >= CRITICAL_AFTER,
    // A to-do being moved holds a short claim ("claim:<time>:<id>"), never shown as a task.
    taskId:
      typeof r.task_id === 'string' && !r.task_id.startsWith('claim:') && !r.task_id.startsWith(DISMISSED)
        ? r.task_id
        : null,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
    doneAt: (r.done_at as number | null) ?? null,
    revision: r.revision as number,
  };
};

// A list label: "#Falcon" and "Falcon" are the same list.
export const listLabel = (value: unknown) =>
  text(value, 'the list', LIMITS.list).replace(/^#+/, '').replace(/\s+/g, ' ').trim();

export function todoFields(value: unknown): TodoInput {
  const t = obj(value, 'to-do');
  const input: TodoInput = {
    title: text(t.title, 'a title', LIMITS.title, true),
    details: text(t.details, 'the details', LIMITS.details),
    priority: t.priority == null ? 'normal' : oneOf(t.priority, ['normal', 'high'] as const, 'priority'),
    dueAt: optionalTime(t.dueAt, 'due date and time'),
    // Absent on an update: the status, list and repeat stay as they are.
    status: t.status == null ? undefined : oneOf(t.status, ['open', 'doing', 'done'] as const, 'status'),
    list: t.list == null ? undefined : listLabel(t.list),
    repeat: t.repeat == null ? undefined : oneOf(t.repeat, TODO_REPEATS, 'repeat'),
  };
  return input;
}

const assertRepeatable = (repeat: TodoRepeat, dueAt: number | null) => {
  if (repeat !== 'none' && dueAt == null) throw bad('Give a repeating to-do a due date.');
};

export async function getTodo(ctx: ModuleContext, id: unknown) {
  const key = recordId(id, 'to-do');
  const r = await ctx.db
    .prepare(`SELECT * FROM as_todos WHERE id = ? AND member = ? AND ${VISIBLE}`)
    .bind(key, owner(ctx))
    .first<Row>();
  if (!r) throw notFound('to-do');
  return todoFrom(r, ctx.now);
}

// Open and in-progress to-dos (with includeDone, done ones too), earliest due first.
export async function listTodos(ctx: ModuleContext, includeDone = false) {
  const r = await ctx.db
    .prepare(
      `SELECT * FROM as_todos WHERE member = ? AND ${VISIBLE}${includeDone ? '' : ` AND ${OPEN}`}
       ORDER BY status = 'done', due_at IS NULL, due_at, created_at DESC LIMIT 1000`,
    )
    .bind(owner(ctx))
    .all<Row>();
  return r.results.map((row) => todoFrom(row, ctx.now));
}

async function assertOpenRoom(ctx: ModuleContext) {
  const r = await ctx.db
    .prepare(`SELECT count(*) AS n FROM as_todos WHERE member = ? AND ${OPEN}`)
    .bind(owner(ctx))
    .first<{ n: number }>();
  if ((r?.n ?? 0) >= LIMITS.openTodos)
    throw new CloudError(
      `You have ${LIMITS.openTodos} open to-dos, the most allowed. Complete or delete some first.`,
      409,
    );
}

const INSERT_TODO =
  'INTO as_todos(id,member,title,details,status,priority,due_at,source,source_ref,source_label,list,repeat,task_id,created_at,updated_at,done_at,revision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
const insertTodo = (ctx: ModuleContext, t: Todo, verb = 'INSERT') =>
  ctx.db
    .prepare(`${verb} ${INSERT_TODO}`)
    .bind(
      t.id,
      owner(ctx),
      t.title,
      t.details,
      t.status,
      t.priority,
      t.dueAt,
      t.source,
      t.sourceRef,
      t.sourceLabel,
      t.list,
      t.repeat,
      null,
      t.createdAt,
      t.updatedAt,
      t.doneAt,
      1,
    );

function newTodo(
  ctx: ModuleContext,
  input: TodoInput,
  source: TodoSource,
  sourceRef: string,
  sourceLabel = '',
): Todo {
  const status = input.status ?? 'open';
  return {
    id: crypto.randomUUID(),
    title: input.title,
    details: input.details,
    status,
    priority: input.priority,
    dueAt: input.dueAt,
    source,
    sourceRef: sourceRef.slice(0, 200),
    sourceLabel: sourceLabel.slice(0, LIMITS.title),
    list: input.list ?? '',
    repeat: input.repeat ?? 'none',
    stale: false,
    critical: status !== 'done' && input.dueAt != null && ctx.now - input.dueAt >= CRITICAL_AFTER,
    taskId: null,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    doneAt: status === 'done' ? ctx.now : null,
    revision: 1,
  };
}

export async function createTodo(
  ctx: ModuleContext,
  input: TodoInput,
  source: TodoSource = 'manual',
  sourceRef = '',
) {
  const todo = newTodo(ctx, input, source, sourceRef);
  assertRepeatable(todo.repeat, todo.dueAt);
  if (todo.status !== 'done') await assertOpenRoom(ctx);
  await insertTodo(ctx, todo).run();
  return todo;
}

// A to-do from another module's item, once per (source, sourceRef). Returns null when that item was
// added before, even if the to-do was completed or deleted since.
export async function createSourcedTodo(
  ctx: ModuleContext,
  input: TodoInput,
  source: 'mail' | 'commitment' | 'meeting',
  sourceRef: string,
  sourceLabel: string,
) {
  if (!sourceRef) throw bad('A source reference is required.');
  const existing = await ctx.db
    .prepare('SELECT id FROM as_todos WHERE member = ? AND source = ? AND source_ref = ?')
    .bind(owner(ctx), source, sourceRef.slice(0, 200))
    .first<Row>();
  if (existing) return null;
  await assertOpenRoom(ctx);
  const todo = newTodo(ctx, { ...input, repeat: 'none' }, source, sourceRef, sourceLabel);
  const r = await insertTodo(ctx, todo, 'INSERT OR IGNORE').run();
  return r.meta.changes ? todo : null;
}

// The due time of the next to-do of a repeating one: the first occurrence after now (a late
// completion skips the occurrences missed in between), at the same time of day in India time.
export function nextTodoDue(dueAt: number, repeat: TodoRepeat, now: number) {
  if (repeat === 'none') return null;
  let next = dueAt;
  let prev: number | null = null;
  for (let i = 0; i < 2000 && (next === dueAt || next <= now); i++) {
    const step: number | null =
      repeat === 'daily'
        ? next + DAY
        : repeat === 'weekly'
          ? next + 7 * DAY
          : repeat === 'fortnightly'
            ? next + 14 * DAY
            : nextOccurrence(next, 'monthly', prev);
    prev = next;
    next = step!;
  }
  return next;
}

export async function updateTodo(ctx: ModuleContext, id: unknown, input: TodoInput, base: number) {
  const current = await getTodo(ctx, id);
  const status = input.status ?? current.status;
  const list = input.list ?? current.list;
  const repeat = input.repeat ?? current.repeat;
  assertRepeatable(repeat, input.dueAt);
  if (status !== 'done' && current.status === 'done') await assertOpenRoom(ctx);
  const doneAt = status === 'done' ? (current.doneAt ?? ctx.now) : null;
  const statements = [
    ctx.db
      .prepare(
        'UPDATE as_todos SET title = ?, details = ?, priority = ?, due_at = ?, status = ?, list = ?, repeat = ?, done_at = ?, updated_at = ?, revision = revision + 1 WHERE id = ? AND member = ? AND revision = ?',
      )
      .bind(
        input.title,
        input.details,
        input.priority,
        input.dueAt,
        status,
        list,
        repeat,
        doneAt,
        ctx.now,
        current.id,
        owner(ctx),
        base,
      ),
  ];
  // Completing a repeating to-do creates the next one in the same batch; the successor's reference is
  // unique, so completing it twice (or reopening and completing again) never makes two.
  if (status === 'done' && current.status !== 'done' && repeat !== 'none' && input.dueAt != null) {
    const next = newTodo(
      ctx,
      {
        title: input.title,
        details: input.details,
        priority: input.priority,
        dueAt: nextTodoDue(input.dueAt, repeat, ctx.now),
        list,
        repeat,
      },
      current.source === 'manual' || current.source === 'chat' || current.source === 'whatsapp'
        ? current.source
        : 'manual',
      '',
    );
    statements.push(
      ctx.db
        .prepare(
          `INSERT OR IGNORE INTO as_todos(id,member,title,details,status,priority,due_at,source,source_ref,source_label,list,repeat,task_id,created_at,updated_at,done_at,revision)
           SELECT ?,?,?,?,'open',?,?,?,?,'',?,?,NULL,?,?,NULL,1 WHERE EXISTS (SELECT 1 FROM as_todos WHERE id = ? AND member = ? AND status = 'done' AND revision = ?)`,
        )
        .bind(
          next.id,
          owner(ctx),
          next.title,
          next.details,
          next.priority,
          next.dueAt,
          next.source,
          REPEAT_REF + current.id,
          next.list,
          next.repeat,
          ctx.now,
          ctx.now,
          current.id,
          owner(ctx),
          base + 1,
        ),
    );
  }
  const r = await ctx.db.batch(statements);
  if (!r[0].meta.changes) throw conflict('to-do');
  return getTodo(ctx, current.id);
}

export async function completeTodo(ctx: ModuleContext, id: unknown) {
  const t = await getTodo(ctx, id);
  if (t.status === 'done') return t;
  return updateTodo(ctx, t.id, { ...t, status: 'done' }, t.revision);
}

// todo.quickAdd: one line of plain words, read without AI (see quickadd.ts).
export async function quickAdd(ctx: ModuleContext, value: unknown, source: TodoSource = 'manual') {
  const line = text(value, 'the to-do', QUICK_ADD_MAX, true);
  const q = parseQuickAdd(line, ctx.now);
  const todo = await createTodo(
    ctx,
    { title: q.title, details: '', priority: q.priority, dueAt: q.dueAt, list: q.list, repeat: q.repeat },
    source,
  );
  return { todo, understood: q.understood };
}

// The next to-do created when this repeating one was completed, if any.
export async function successorOf(ctx: ModuleContext, id: string) {
  const r = await ctx.db
    .prepare(`SELECT * FROM as_todos WHERE member = ? AND source_ref = ? AND ${VISIBLE}`)
    .bind(owner(ctx), REPEAT_REF + id)
    .first<Row>();
  return r ? todoFrom(r, ctx.now) : null;
}

// A to-do the member made is deleted. One from another module's item is dismissed instead: kept,
// hidden and marked done, so the email, commitment or action item does not bring it back.
export async function deleteTodo(ctx: ModuleContext, id: unknown) {
  const key = recordId(id, 'to-do');
  const r = await ctx.db.batch([
    ctx.db
      .prepare(
        `UPDATE as_todos SET status = 'done', done_at = coalesce(done_at, ?), task_id = ?, updated_at = ?, revision = revision + 1
         WHERE id = ? AND member = ? AND source IN ('mail','commitment','meeting') AND source_ref != '' AND ${VISIBLE}`,
      )
      .bind(ctx.now, DISMISSED + ctx.now, ctx.now, key, owner(ctx)),
    ctx.db
      .prepare(
        `DELETE FROM as_todos WHERE id = ? AND member = ? AND NOT (source IN ('mail','commitment','meeting') AND source_ref != '')`,
      )
      .bind(key, owner(ctx)),
  ]);
  if (!r[0].meta.changes && !r[1].meta.changes) throw notFound('to-do');
  return true as const;
}

// Moves a to-do onto a mandate as a Workflow task. The to-do is claimed first, so two requests at once
// cannot create two tasks; the claim is released if the task cannot be created.
export async function todoToTask(ctx: ModuleContext, p: Record<string, unknown>) {
  const todo = await getTodo(ctx, p.id);
  if (todo.taskId) throw new CloudError('This to-do has already been moved to a task.', 409);
  // A claim older than two minutes was left by a request that did not finish.
  if (todo.status === 'done') throw new CloudError('Only an open to-do can be moved to a task.', 409);
  if (typeof p.matterId !== 'string' || !p.matterId) throw bad('Choose a mandate.');
  if (p.assignee != null && typeof p.assignee !== 'string') throw bad('Choose a valid assignee.');
  const claim = `claim:${ctx.now}:${crypto.randomUUID()}`;
  const claimed = await ctx.db
    .prepare(
      "UPDATE as_todos SET task_id = ? WHERE id = ? AND member = ? AND status IN ('open','doing') AND (task_id IS NULL OR (task_id LIKE 'claim:%' AND task_id < ?))",
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
    status: r.status == null ? undefined : oneOf(r.status, ['active', 'paused'] as const, 'status'),
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
    .prepare("SELECT * FROM as_reminders WHERE member = ? ORDER BY status = 'done', due_at LIMIT 1000")
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
  // Without a status a paused reminder stays paused; a finished one is scheduled again.
  const status = input.status ?? (current.status === 'paused' ? 'paused' : 'active');
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
    throw bad(
      'Memory is not a safe place for passwords, PINs or card numbers. Keep them in a password manager.',
    );
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
