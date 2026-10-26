'use client';
// Mandate Meetings tab: Scribe meeting notes linked to the mandate by their owners, with the shared
// summary, action items (each can become one task) and, where shared, the transcript.
import { useState } from 'react';
import { CalendarDays, CheckCircle2, ListPlus, NotebookPen, ScrollText, Unlink } from 'lucide-react';
import { handOver } from '../../../core/client/handover';
import type { Matter, MeetingAction, MeetingLink, PersonKey } from '../shared/types';
import { Empty } from './components/Bits';
import { ConfirmButton } from './components/ConfirmButton';
import { DateInput } from './components/Inputs';
import { Modal } from './components/Modal';
import { PersonBadge, PersonPicker } from './components/People';
import { formatDate, formatStamp, plural, type Member, type Nav } from './lib';
import { useRemote, useWF } from './store';
import { TaskDrawer } from './TaskDrawer';

const SUMMARY_PREVIEW = 700;

// The member an action item's owner most likely refers to: an email, a full name or a first name.
function suggestedAssignee(owner: string, members: Member[]): PersonKey | null {
  const o = owner.trim().toLowerCase();
  if (!o) return null;
  const active = members.filter((m) => m.active);
  const hit =
    active.find((m) => m.email.toLowerCase() === o) ??
    active.find((m) => m.name.toLowerCase() === o) ??
    active.find((m) => m.initials.toLowerCase() === o) ??
    (active.filter((m) => m.name.toLowerCase().split(/\s+/)[0] === o).length === 1
      ? active.find((m) => m.name.toLowerCase().split(/\s+/)[0] === o)
      : undefined);
  return hit?.email ?? null;
}

export function MatterMeetingsTab({ matter, navigate }: { matter: Matter; navigate: Nav }) {
  const { run, meEmail, caps, focusTask, setFocusTask } = useWF();
  const list = useRemote(`meetings:${matter.id}`, () => run('meetings.list', { matterId: matter.id }));
  const links = list.data ?? [];

  return (
    <div className="card wf-section">
      <p className="wf-caption wf-meeting-intro">
        Meeting notes from Scribe, shared by the person who took them. Each is a copy: it changes only when
        they update it from the note.
      </p>
      {list.loading && !list.data ? (
        <p className="wf-loading" role="status">
          Loading meeting notes
        </p>
      ) : !links.length ? (
        <Empty icon={CalendarDays} title="No meeting notes yet">
          Open a meeting in Scribe and choose Link to a mandate. You choose whether its transcript is shared.
        </Empty>
      ) : (
        <ul className="wf-meetings">
          {links.map((l) => (
            <MeetingCard
              key={l.id}
              link={l}
              mine={l.linkedBy === meEmail}
              canUnlink={l.linkedBy === meEmail || caps.manageMatters}
              onChanged={list.reload}
              onOpenTask={setFocusTask}
              onOpenNote={() => {
                handOver('scribe.note', { noteId: l.noteId });
                navigate('notes');
              }}
            />
          ))}
        </ul>
      )}
      {focusTask && <TaskDrawer taskId={focusTask} onClose={() => setFocusTask(null)} />}
    </div>
  );
}

function MeetingCard({
  link,
  mine,
  canUnlink,
  onChanged,
  onOpenTask,
  onOpenNote,
}: {
  link: MeetingLink;
  mine: boolean;
  canUnlink: boolean;
  onChanged: () => void;
  onOpenTask: (id: string) => void;
  onOpenNote: () => void;
}) {
  const { run, notify, tasks } = useWF();
  const [full, setFull] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const open = link.actions.filter((a) => !a.taskId);
  const long = link.summary.length > SUMMARY_PREVIEW;
  const summary = full || !long ? link.summary : link.summary.slice(0, SUMMARY_PREVIEW).trimEnd() + '…';
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  const showTranscript = async () => {
    if (transcript !== null) return setTranscript(null);
    const r = await run('meetings.transcript', { id: link.id });
    if (r) setTranscript(r.transcript);
  };

  return (
    <li className="wf-meeting">
      <div className="wf-meeting-head">
        <div>
          <h3 className="wf-h3">{link.title}</h3>
          <p className="wf-caption">
            {formatStamp(link.meetingAt)}
            {link.attendees.length > 0 && ` · ${plural(link.attendees.length, 'attendee')}`}
          </p>
        </div>
        <div className="wf-row wf-wrap wf-caption">
          <span>Shared by</span> <PersonBadge person={link.linkedBy} showName />
          <span>· updated {formatStamp(link.updatedAt)}</span>
        </div>
      </div>
      {link.attendees.length > 0 && (
        <p className="wf-caption wf-meeting-people">{link.attendees.slice(0, 12).join(', ')}</p>
      )}
      {link.summary ? (
        <div className="wf-meeting-summary">
          <p>{summary}</p>
          {long && (
            <button type="button" className="text-link" onClick={() => setFull(!full)}>
              {full ? 'Show less' : 'Show the full summary'}
            </button>
          )}
        </div>
      ) : (
        <p className="wf-empty-line">No summary was shared.</p>
      )}

      <h4 className="wf-h4">Action items ({link.actions.length})</h4>
      {link.actions.length ? (
        <ul className="wf-meeting-actions">
          {link.actions.map((a) => {
            const task = a.taskId ? taskById.get(a.taskId) : undefined;
            return (
              <li key={a.id}>
                {a.taskId ? (
                  <CheckCircle2 size={16} className="wf-green" aria-label="Task created" />
                ) : (
                  <input
                    type="checkbox"
                    aria-label={`Choose "${a.text}"`}
                    checked={chosen.includes(a.id)}
                    onChange={() => toggle(a.id)}
                  />
                )}
                <span className="grow">
                  {a.text}
                  {(a.owner || a.due) && (
                    <span className="wf-caption">
                      {' '}
                      ({[a.owner, a.due && 'due ' + formatDate(a.due)].filter(Boolean).join(', ')})
                    </span>
                  )}
                </span>
                {a.taskId &&
                  (task ? (
                    <button type="button" className="text-link" onClick={() => onOpenTask(task.id)}>
                      Open task
                    </button>
                  ) : (
                    <span className="wf-caption">Task removed</span>
                  ))}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="wf-empty-line">No action items in this note.</p>
      )}

      <div className="wf-row wf-wrap wf-meeting-foot">
        {open.length > 0 && (
          <button
            type="button"
            className="button primary"
            disabled={!chosen.length}
            onClick={() => setCreating(true)}
          >
            <ListPlus size={15} /> Create {chosen.length > 1 ? `${chosen.length} tasks` : 'task'}
          </button>
        )}
        {link.includeTranscript && (
          <button
            type="button"
            className="button secondary"
            aria-expanded={transcript !== null}
            onClick={() => void showTranscript()}
          >
            <ScrollText size={15} /> {transcript !== null ? 'Hide transcript' : 'Show transcript'}
          </button>
        )}
        {mine && (
          <button type="button" className="button ghost" onClick={onOpenNote}>
            <NotebookPen size={15} /> Open my note
          </button>
        )}
        {canUnlink && (
          <ConfirmButton
            className="button ghost"
            question="Remove this note from the mandate? Tasks already created stay."
            confirmLabel="Remove"
            onConfirm={async () => {
              if (await run('meetings.unlink', { id: link.id })) {
                notify('Meeting note removed from the mandate');
                onChanged();
              }
            }}
          >
            <Unlink size={15} /> Remove
          </ConfirmButton>
        )}
      </div>
      {transcript !== null && (
        <pre className="wf-transcript" tabIndex={0} aria-label="Shared transcript">
          {transcript || 'The transcript is empty.'}
        </pre>
      )}
      {creating && (
        <CreateTasks
          link={link}
          actions={link.actions.filter((a) => chosen.includes(a.id) && !a.taskId)}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            setChosen([]);
            onChanged();
          }}
        />
      )}
    </li>
  );
}

function CreateTasks({
  link,
  actions,
  onClose,
  onDone,
}: {
  link: MeetingLink;
  actions: MeetingAction[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { run, dispatch, notify, members } = useWF();
  const [rows, setRows] = useState(() =>
    actions.map((a) => ({
      actionId: a.id,
      title: a.text.slice(0, 300),
      assignee: suggestedAssignee(a.owner, members),
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(a.due) ? a.due : null,
      owner: a.owner,
    })),
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (i: number, patch: Partial<(typeof rows)[number]>) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const save = async () => {
    if (rows.some((r) => !r.title.trim())) return setError('Enter a title for every task.');
    setBusy(true);
    setError('');
    const r = await run(
      'meetings.createTasks',
      {
        id: link.id,
        baseRevision: link.revision,
        items: rows.map(({ actionId, title, assignee, dueDate }) => ({
          actionId,
          title: title.trim(),
          assignee,
          dueDate,
        })),
      },
      { onError: setError },
    );
    setBusy(false);
    if (!r) return;
    for (const task of r.tasks) dispatch({ type: 'task', task });
    notify(r.tasks.length === 1 ? 'Task created' : `${r.tasks.length} tasks created`);
    onDone();
  };

  return (
    <Modal
      title="Create tasks from action items"
      subtitle={`From "${link.title}". Each item becomes one task on this mandate.`}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="button ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="button primary" disabled={busy} onClick={() => void save()}>
            Create {rows.length === 1 ? 'task' : `${rows.length} tasks`}
          </button>
        </>
      }
    >
      <ol className="wf-create-tasks">
        {rows.map((r, i) => (
          <li key={r.actionId}>
            <label className="wf-field">
              <span>Task</span>
              <input
                className="wf-input"
                value={r.title}
                maxLength={300}
                onChange={(e) => set(i, { title: e.target.value })}
              />
            </label>
            <div className="wf-row wf-wrap">
              <PersonPicker label="Assign to" value={r.assignee} onChange={(v) => set(i, { assignee: v })} />
              <DateInput label="Due date" value={r.dueDate} onChange={(v) => set(i, { dueDate: v })} />
            </div>
            {r.owner && <p className="wf-caption">Owner in the note: {r.owner}</p>}
          </li>
        ))}
      </ol>
      {error && (
        <p className="wf-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
