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
