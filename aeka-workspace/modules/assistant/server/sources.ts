// To-dos from other modules' items that the member asks for: the action items of one of their own
// Scribe notes. Each item is added once; a removed one is not added again.
import { CloudError } from '../../../lib/cloud-store.ts';
import type { ModuleContext } from '../../../core/server/module.ts';
import { noteDetails } from '../../../lib/note-details.ts';
import { readOwnNote } from '../../scribe/server/notes.ts';
import type { Todo } from '../shared/types.ts';
import { EOD_MINUTES } from './quickadd.ts';
import { createSourcedTodo } from './records.ts';
import { MINUTE } from './recurrence.ts';
import { LIMITS } from './validate.ts';

// 18:00 India time on a YYYY-MM-DD date, or null.
export function dueAtEod(date: string | null | undefined) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const day = Date.parse(date + 'T00:00:00+05:30');
  return Number.isFinite(day) ? day + EOD_MINUTES * MINUTE : null;
}

export async function notesToTodos(ctx: ModuleContext, noteId: unknown) {
  // Notes belong to the sign-in, which only a signed-in browser request has.
  if (!ctx.user.userId)
    throw new CloudError('Open the note in your web workspace to add its action items.', 409);
  const note = await readOwnNote(ctx.db, ctx.user.userId, noteId);
  const label = (note.title.trim() || 'Untitled note').slice(0, LIMITS.title);
  const added: Todo[] = [];
  let skipped = 0;
  for (const a of noteDetails(note).actions) {
    const text = a.text.replace(/\s+/g, ' ').trim();
    if (!text || a.done) {
      skipped++;
      continue;
    }
    const title = text.length > LIMITS.title ? text.slice(0, LIMITS.title - 1).trimEnd() + '…' : text;
    const details = [
      text.length > LIMITS.title ? text : '',
      a.owner.trim() ? `Owner: ${a.owner.trim()}` : '',
      `From the meeting note "${label}".`,
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, LIMITS.details);
    const todo = await createSourcedTodo(
      ctx,
      { title, details, priority: 'normal', dueAt: dueAtEod(a.due) },
      'meeting',
      `${note.id}:${a.id}`,
      label,
    );
    if (todo) added.push(todo);
    else skipped++;
  }
  return { added, skipped };
}
