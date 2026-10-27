// The assistant's services for other modules. SIGNATURES ARE FIXED; implementations are filled in by
// the assistant server work.
import type { ModuleContext } from '../../../core/server/module.ts';

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
// done or deleted since, so a removed item is not re-created). SIGNATURE FIXED; implemented by the
// assistant server work.
export async function addTodoFrom(
  _ctx: ModuleContext,
  _input: {
    title: string;
    details?: string;
    dueAt?: number | null;
    priority?: 'normal' | 'high';
    list?: string;
    source: 'mail' | 'commitment' | 'meeting';
    sourceRef: string;
    sourceLabel: string;
  },
): Promise<import('../shared/types.ts').Todo | null> {
  throw new Error('Assistant service not implemented yet.');
}
