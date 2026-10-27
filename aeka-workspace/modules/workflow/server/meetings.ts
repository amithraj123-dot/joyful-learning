// Scribe meeting notes linked to mandates. The note's owner shares a copy with everyone who can see the
// mandate; the note itself stays private. Notes are read through Scribe's service, never its tables.
import { CloudError } from '../../../lib/cloud-store.ts';
import type { ModuleAction, ModuleContext } from '../../../core/server/module.ts';
import { readOwnNote, sharedCopy } from '../../scribe/server/notes.ts';
import type { MeetingAction, MeetingLink, MeetingTarget, Task } from '../shared/types.ts';
import {
  all,
  clients,
  conflict,
  insert,
  insertWhere,
  meetingLinks,
  meetingTranscripts,
  one,
  remove,
  tasks,
  update,
  write,
  type MeetingLinkRow,
} from './db.ts';
import { loadPeople } from './people.ts';
import { forbidden, isManager, me, visibleChild, visibleMatter, visibleMatters } from './permissions.ts';
import { matterTargets } from './services.ts';
import { newTask, notifyAssignee } from './tasks.ts';
import { baseRevision, bool, obj, optionalDate, text } from './validate.ts';

const MAX_TASKS_AT_ONCE = 50;

const shown = (row: MeetingLinkRow): MeetingLink => {
  const link: Partial<MeetingLinkRow> = { ...row };
  delete link.ownerUser;
  return link as MeetingLink;
};
const newestFirst = (a: MeetingLink, b: MeetingLink) =>
  b.meetingAt - a.meetingAt || b.updatedAt - a.updatedAt;

async function findLink(ctx: ModuleContext, key: unknown) {
  const { record, matter } = await visibleChild(ctx, meetingLinks, key, 'meeting note');
  return { link: record, matter };
}

// Inserts a task only if the saved link records it, so a stale request (whose link update was refused)
// creates nothing, and an item never gets two tasks.
const recordedTask = (ctx: ModuleContext, linkId: string, task: Task) =>
  insertWhere(
    ctx.db,
    tasks,
    task,
    "EXISTS (SELECT 1 FROM wf_meeting_links l, json_each(l.actions) a WHERE l.id = ? AND json_extract(a.value, '$.taskId') = ?)",
    linkId,
    task.id,
  );

export const meetingActions: Record<string, ModuleAction> = {
  'meetings.list': {
    handler: async (ctx, p) => {
      const matter = await visibleMatter(ctx, p.matterId);
      return (await all(ctx.db, meetingLinks, 'matter_id = ?', matter.id)).map(shown).sort(newestFirst);
    },
  },
  'meetings.transcript': {
    handler: async (ctx, p) => {
      const { link } = await findLink(ctx, p.id);
      if (!link.includeTranscript) return { transcript: '' };
      const row = await one(ctx.db, meetingTranscripts, 'link_id = ?', link.id);
      return { transcript: row?.transcript ?? '' };
    },
  },
  'meetings.forNote': {
    handler: async (ctx, p) => {
      if (typeof p.noteId !== 'string' || !p.noteId) return [];
      const links = await all(
        ctx.db,
        meetingLinks,
        'owner_user = ? AND note_id = ?',
        ctx.user.userId,
        p.noteId,
      );
      if (!links.length) return [];
      const visible = new Map((await visibleMatters(ctx)).map((m) => [m.id, m]));
      const names = new Map((await all(ctx.db, clients)).map((c) => [c.id, c.name]));
      return links
        .filter((l) => visible.has(l.matterId))
        .map((l) => {
          const matter = visible.get(l.matterId)!;
          return { ...shown(l), matterTitle: matter.title, clientName: names.get(matter.clientId) ?? '' };
        })
        .sort(
          (a, b) => a.clientName.localeCompare(b.clientName) || a.matterTitle.localeCompare(b.matterTitle),
        );
    },
  },
  'meetings.targets': { handler: (ctx) => matterTargets(ctx) },
  'meetings.link': {
    handler: async (ctx, p) => {
      const member = me(ctx);
      const includeTranscript = bool(p.includeTranscript, 'sharing the transcript');
      const matter = await visibleMatter(ctx, p.matterId);
      const note = await readOwnNote(ctx.db, ctx.user.userId, p.noteId);
      const copy = sharedCopy(note, includeTranscript);
      const current = await one(
        ctx.db,
        meetingLinks,
        'matter_id = ? AND owner_user = ? AND note_id = ?',
        matter.id,
        ctx.user.userId,
        note.id,
      );
      // Items keep the task already created from them, including items since removed from the note.
      const before = new Map((current?.actions ?? []).map((a) => [a.id, a]));
      const actions: MeetingAction[] = copy.actions.map((a) => ({
        ...a,
        taskId: before.get(a.id)?.taskId ?? null,
      }));
      const kept = new Set(actions.map((a) => a.id));
      for (const a of current?.actions ?? []) if (a.taskId && !kept.has(a.id)) actions.push(a);
      const link: MeetingLinkRow = {
        id: current?.id ?? crypto.randomUUID(),
        matterId: matter.id,
        ownerUser: ctx.user.userId,
        noteId: note.id,
        title: copy.title,
        meetingAt: copy.meetingAt,
        attendees: copy.attendees,
        summary: copy.summary,
        actions,
        includeTranscript,
        transcriptChars: copy.transcript.length,
        linkedBy: member.email,
        createdAt: current?.createdAt ?? ctx.now,
        updatedAt: ctx.now,
        revision: (current?.revision ?? 0) + 1,
      };
      // A first link that loses a race with another (same note and mandate) inserts nothing, and its
      // transcript is written only if its link row exists.
      const transcript = includeTranscript
        ? ctx.db
            .prepare(
              'INSERT INTO wf_meeting_transcripts(link_id,transcript) SELECT ?,? WHERE EXISTS (SELECT 1 FROM wf_meeting_links WHERE id = ?) ON CONFLICT(link_id) DO UPDATE SET transcript = excluded.transcript',
            )
            .bind(link.id, copy.transcript, link.id)
        : remove(ctx.db, meetingTranscripts, link.id);
      const [changed] = await write(ctx.db, ctx.now, [
        current
          ? update(ctx.db, meetingLinks, link, current.revision)
          : insert(ctx.db, meetingLinks, link, true),
        transcript,
      ]);
      if (!changed) throw conflict('meeting note');
      await ctx.log(
        current ? 'meeting.updated' : 'meeting.linked',
        link.id,
        current
          ? `Updated the shared meeting note "${link.title}" on ${matter.title}`
          : `Linked meeting note "${link.title}" to ${matter.title}${includeTranscript ? ', with its transcript' : ''}`,
      );
      return shown(link);
    },
  },
  'meetings.unlink': {
    handler: async (ctx, p) => {
      const { link, matter } = await findLink(ctx, p.id);
      const m = me(ctx);
      if (link.linkedBy !== m.email && !isManager(m))
        throw forbidden('Only the person who linked this note or a Manager and above can remove it.');
      await write(ctx.db, ctx.now, [
        remove(ctx.db, meetingLinks, link.id),
        remove(ctx.db, meetingTranscripts, link.id),
      ]);
      await ctx.log('meeting.unlinked', link.id, `Removed meeting note "${link.title}" from ${matter.title}`);
      return true;
    },
  },
  'meetings.createTasks': {
    handler: async (ctx, p) => {
      const { link, matter } = await findLink(ctx, p.id);
      const base = baseRevision(p);
      if (link.revision !== base) throw conflict('meeting note');
      if (!Array.isArray(p.items) || !p.items.length)
        throw new CloudError('Choose at least one action item.');
      if (p.items.length > MAX_TASKS_AT_ONCE)
        throw new CloudError(`Create up to ${MAX_TASKS_AT_ONCE} tasks at a time.`);
      const people = await loadPeople(ctx.db);
      const actions = link.actions.map((a) => ({ ...a }));
      const created: Task[] = [];
      for (const value of p.items) {
        const item = obj(value, 'action item');
        const action = actions.find((a) => a.id === item.actionId);
        if (!action) throw new CloudError('An action item is no longer in this note. Reload and try again.');
        if (action.taskId)
          throw new CloudError(`A task already exists for "${action.text.slice(0, 80)}".`, 409);
        const { task } = await newTask(ctx, people, {
          matterId: matter.id,
          title: text(item.title, 'the task title', 300, true),
          status: 'Preparing',
          assignee: item.assignee ?? null,
          preparedBy: null,
          reviewedBy: null,
          dueDate: optionalDate(item.dueDate, 'the due date'),
          priority: false,
          notes: `From the meeting "${link.title}"${action.owner ? `; owner in the note: ${action.owner}` : ''}.`,
          steps: [],
        });
        action.taskId = task.id;
        created.push(task);
      }
      const saved: MeetingLinkRow = { ...link, actions, revision: base + 1 };
      const [changed] = await write(ctx.db, ctx.now, [
        update(ctx.db, meetingLinks, saved, base),
        ...created.map((t) => recordedTask(ctx, link.id, t)),
      ]);
      if (!changed) throw conflict('meeting note');
      for (const t of created) {
        await ctx.log(
          'task.created',
          t.id,
          `Created task "${t.title}" on ${matter.title} from a meeting note`,
        );
        await notifyAssignee(ctx, t, matter);
      }
      return { link: shown(saved), tasks: created };
    },
  },
};
