// The assistant's services for other modules. SIGNATURES ARE FIXED; implementations are filled in by
// the assistant server work.
import { CloudError } from '../../../lib/cloud-store.ts';
import type { ModuleContext } from '../../../core/server/module.ts';
import type { Todo } from '../shared/types.ts';
import { createSourcedTodo } from './records.ts';
import { LIMITS, optionalTime } from './validate.ts';

// The caller's writing-style and preference memories (title: content), for drafting emails in their
// voice. At most 20 entries, newest first.
export async function styleNotes(ctx: ModuleContext): Promise<string[]> {
  const r = await ctx.db
    .prepare(
      "SELECT title, content FROM as_memory WHERE member = ? AND category IN ('style','preference') ORDER BY updated_at DESC LIMIT 20",
    )
    .bind(ctx.member?.email ?? '')
    .all<{ title: string; content: string }>();
  return r.results.map((m) => `${m.title}: ${m.content}`.slice(0, 600));
}

// Adds a to-do for the caller from another module's item (an email ask, a commitment in sent mail, a
// meeting action item), once per (source, sourceRef): returns null when it already exists (even if
// done or deleted since, so a removed item is not re-created). SIGNATURE FIXED.
// Text is trimmed and shortened to the to-do limits rather than refused; an invalid due time is
// dropped. Throws (409) when the member already has the most open to-dos allowed.
export async function addTodoFrom(
  ctx: ModuleContext,
  input: {
    title: string;
    details?: string;
    dueAt?: number | null;
    priority?: 'normal' | 'high';
    list?: string;
    source: 'mail' | 'commitment' | 'meeting' | 'phone';
    sourceRef: string;
    sourceLabel: string;
  },
): Promise<Todo | null> {
  if (!ctx.member) throw new CloudError('You do not have permission for this action.', 403);
  const one = (s: unknown, n: number) =>
    typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, n) : '';
  const title = one(input.title, LIMITS.title);
  const sourceRef = typeof input.sourceRef === 'string' ? input.sourceRef.trim().slice(0, 200) : '';
  if (!title) throw new CloudError('A to-do needs a title.');
  if (!['mail', 'commitment', 'meeting', 'phone'].includes(input.source) || !sourceRef)
    throw new CloudError('A to-do from another module needs its source.');
  let dueAt: number | null = null;
  try {
    dueAt = optionalTime(input.dueAt, 'due time');
  } catch {
    dueAt = null;
  }
  return createSourcedTodo(
    ctx,
    {
      title,
      details: typeof input.details === 'string' ? input.details.trim().slice(0, LIMITS.details) : '',
      priority: input.priority === 'high' ? 'high' : 'normal',
      dueAt,
      list: one(input.list, LIMITS.list).replace(/^#+/, ''),
    },
    input.source,
    sourceRef,
    one(input.sourceLabel, LIMITS.title),
  );
}

// The notice for a to-do falling due. The same key is used by the background work and by the phone's
// own alarm (module chats), so the phone shows it once.
export const todoDueNotice = (t: { id: string; title: string; due_at: number }) => ({
  key: `todo.due:${t.id}:${t.due_at}`,
  title: `Due now: ${t.title}`.slice(0, 200),
  body: 'Complete it, or give it a new date, in Aeka.',
  link: `assistant/todos#${t.id}`,
});

// Open to-dos and active reminders of one member due after `from` and up to `until`, earliest first,
// as phone alerts (key, time, title, body, link). Keys match the notices raised when they fall due.
export async function dueSoon(
  db: D1Database,
  member: string,
  from: number,
  until: number,
  o: { todos: boolean; reminders: boolean },
) {
  const out: { key: string; at: number; title: string; body: string; link: string }[] = [];
  if (o.todos) {
    const todos = await db
      .prepare(
        `SELECT id, title, due_at FROM as_todos WHERE member = ? AND status IN ('open','doing') AND due_at > ? AND due_at <= ?
         AND (task_id IS NULL OR task_id NOT LIKE 'dismissed:%') ORDER BY due_at LIMIT 40`,
      )
      .bind(member, from, until)
      .all<{ id: string; title: string; due_at: number }>();
    for (const t of todos.results) out.push({ ...todoDueNotice(t), at: t.due_at });
  }
  if (o.reminders) {
    const reminders = await db
      .prepare(
        "SELECT id, title, due_at FROM as_reminders WHERE member = ? AND status = 'active' AND due_at > ? AND due_at <= ? ORDER BY due_at LIMIT 40",
      )
      .bind(member, from, until)
      .all<{ id: string; title: string; due_at: number }>();
    for (const r of reminders.results)
      out.push({
        key: `reminder:${r.id}:${r.due_at}`,
        at: r.due_at,
        title: r.title,
        body: 'Reminder from Aeka.',
        link: `assistant/todos#${r.id}`,
      });
  }
  return out.sort((a, b) => a.at - b.at).slice(0, 50);
}
