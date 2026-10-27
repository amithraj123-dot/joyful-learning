'use client';
// Personal to-dos: quick add in plain words, lists, repeats, a list or board view (To do, Doing, Done),
// source badges back to the email or meeting, and moving a to-do onto a mandate as a Workflow task.
import { useId, useMemo, useState, type DragEvent, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  Check,
  FileText,
  ListTodo,
  Mail,
  MailCheck,
  MessageSquareText,
  Pencil,
  Repeat2,
  RotateCcw,
  Star,
  Tag,
  Trash2,
} from 'lucide-react';
import { callModule } from '../../../core/client/api';
import { assistant } from '../shared/client';
import type { TodoInput } from '../shared/contract';
import { TODO_REPEATS, type Todo, type TodoRepeat, type TodoStatus } from '../shared/types';
import { Modal } from '../../workflow/ui/components/Modal';
import { ConfirmButton } from '../../workflow/ui/components/ConfirmButton';
import { Chips, Empty, Toggle } from '../../workflow/ui/components/Bits';
import { Field } from '../../workflow/ui/components/Inputs';
import { useAssistant } from './context';
import { InlineError, LoadError, Loading } from './Bits';
import { QUICK_ADD_EXAMPLE, Understood, useQuickAdd } from './QuickCapture';
import {
  CONFLICT,
  core,
  errorMessage,
  formatWhen,
  fromIst,
  isConflict,
  isDateOnly,
  istParts,
  nowMs,
  todayIst,
  useClock,
  useLoad,
  type MandateTarget,
  type Member,
} from './lib';

export type TodoView = 'list' | 'board';
export const TODO_VIEWS = ['list', 'board'] as const;

export const TODO_REPEAT_LABELS: Record<TodoRepeat, string> = {
  none: 'Does not repeat',
  daily: 'Every day',
  weekly: 'Every week',
  fortnightly: 'Every two weeks',
  monthly: 'Every month',
};
const STATUS_LABELS: Record<TodoStatus, string> = { open: 'To do', doing: 'Doing', done: 'Done' };
const NO_LIST = '\u0000none';

// Due time from a date and an optional time; a date alone means the end of that day.
export function dueFrom(date: string, time: string) {
  if (!date && !time) return null;
  return fromIst(date || todayIst(), time || '23:59');
}
export function dueParts(ms: number | null) {
  if (ms == null) return { date: '', time: '' };
  const p = istParts(ms);
  return { date: p.date, time: isDateOnly(ms) ? '' : p.time };
}
// The full input for an update, so list and repeat are never lost.
const inputOf = (t: Todo, change: Partial<TodoInput> = {}): TodoInput => ({
  title: t.title,
  details: t.details,
  priority: t.priority,
  dueAt: t.dueAt,
  status: t.status,
  list: t.list,
  repeat: t.repeat,
  ...change,
});

const byOrder = (a: Todo, b: Todo) =>
  Number(b.critical) - Number(a.critical) ||
  (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1) ||
  (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) ||
  a.createdAt - b.createdAt;
const byDone = (a: Todo, b: Todo) => (b.doneAt ?? b.updatedAt) - (a.doneAt ?? a.updatedAt);

// Where a to-do came from, linked back to the email or the meeting note when there is one.
function sourceOf(t: Todo) {
  const ref = t.sourceRef;
  const label = t.sourceLabel ? ': ' + t.sourceLabel : '';
  switch (t.source) {
    case 'mail':
      return {
        icon: Mail,
        text: 'From an email' + label,
        link: ref ? 'mail/inbox#' + ref : '',
        what: 'email',
      };
    case 'commitment':
      return {
        icon: MailCheck,
        text: 'You promised this' + (t.sourceLabel ? ' in: ' + t.sourceLabel : ' in an email'),
        link: ref ? 'mail/inbox#' + ref.split(':')[0] : '',
        what: 'sent email',
      };
    case 'meeting':
      return {
        icon: FileText,
        text: 'From a meeting' + label,
        link: ref ? 'notes#' + ref.split(':')[0] : '',
        what: 'meeting note',
      };
    case 'chat':
      return { icon: MessageSquareText, text: 'From Ask Aeka', link: '', what: '' };
    case 'whatsapp':
      return { icon: MessageSquareText, text: 'From WhatsApp', link: '', what: '' };
    default:
      return null;
  }
}

export function SourceBadge({ todo }: { todo: Todo }) {
  const { open } = useAssistant();
  const s = sourceOf(todo);
  if (!s) return null;
  const Icon = s.icon;
  if (!s.link)
    return (
      <span className="as-source">
        <Icon size={12} aria-hidden="true" /> {s.text}
      </span>
    );
  return (
    <button
      type="button"
      className="as-source link"
      onClick={() => open(s.link)}
      aria-label={`${s.text}. Open the ${s.what}`}
    >
      <Icon size={12} aria-hidden="true" /> <span>{s.text}</span>
    </button>
  );
}

// The badges under a to-do title: state, priority, due, list, repeat and source.
function TodoMeta({ todo, id, board }: { todo: Todo; id: string; board?: boolean }) {
  const now = useClock();
  const done = todo.status === 'done';
  const overdue = !done && todo.dueAt != null && todo.dueAt < now;
  return (
    <p className="as-item-meta" id={id}>
      {!done && todo.critical && (
        <span className="wf-pill red as-pill-sm" title="Due 3 or more days ago">
          Critical: 3+ days overdue
        </span>
      )}
      {!done && todo.stale && (
        <span className="wf-pill amber as-pill-sm" title="Open for more than 7 days without a due date">
          Stale: no date for a week
        </span>
      )}
      {todo.status === 'doing' && !board && <span className="wf-pill blue as-pill-sm">Doing</span>}
      {todo.priority === 'high' && !done && (
        <span className="as-flag">
          <Star size={12} aria-hidden="true" /> High priority
        </span>
      )}
      {todo.dueAt != null && !done && !todo.critical && (
        <span className={overdue ? 'wf-overdue' : ''}>
          {overdue ? 'Overdue: ' : 'Due '}
          {formatWhen(todo.dueAt)}
        </span>
      )}
      {todo.dueAt != null && !done && todo.critical && <span>Was due {formatWhen(todo.dueAt)}</span>}
      {done && todo.doneAt && <span>Done {formatWhen(todo.doneAt)}</span>}
      {todo.list && (
        <span className="as-tag">
          <Tag size={11} aria-hidden="true" /> {todo.list}
        </span>
      )}
      {todo.repeat !== 'none' && (
        <span className="as-repeat">
          <Repeat2 size={12} aria-hidden="true" /> {TODO_REPEAT_LABELS[todo.repeat]}
        </span>
      )}
      {todo.taskId && <span className="as-tag">Moved to a mandate</span>}
      <SourceBadge todo={todo} />
    </p>
  );
}

function TodoEditor({
  todo,
  lists,
  onClose,
  onSaved,
  onConflict,
}: {
  todo: Todo;
  lists: string[];
  onClose: () => void;
  onSaved: (t: Todo) => void;
  onConflict: () => void;
}) {
  const start = dueParts(todo.dueAt);
  const [title, setTitle] = useState(todo.title);
  const [details, setDetails] = useState(todo.details);
  const [high, setHigh] = useState(todo.priority === 'high');
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [list, setList] = useState(todo.list);
  const [repeat, setRepeat] = useState<TodoRepeat>(todo.repeat);
  const [status, setStatus] = useState<TodoStatus>(todo.status === 'done' ? 'open' : todo.status);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { notify } = useAssistant();
  const listsId = useId();
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError('A to-do needs a title.');
    setBusy(true);
    setError('');
    try {
      const input = inputOf(todo, {
        title: title.trim(),
        details: details.trim(),
        priority: high ? 'high' : 'normal',
        dueAt: dueFrom(date, time),
        status: todo.status === 'done' ? 'done' : status,
        list: list.trim().replace(/^#/, ''),
        repeat,
      });
      onSaved(await assistant('todo.update', { id: todo.id, todo: input, baseRevision: todo.revision }));
      notify('To-do saved');
      onClose();
    } catch (err) {
      if (isConflict(err)) {
        onConflict();
        onClose();
      } else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Edit to-do"
      onClose={onClose}
      footer={
        <div className="wf-form-actions as-actions-end">
          <button type="button" className="button ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="as-todo-edit" className="button primary" disabled={busy}>
            {busy ? 'Saving' : 'Save'}
          </button>
        </div>
      }
    >
      <form id="as-todo-edit" onSubmit={save}>
        <Field label="Title">
          <input value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} data-autofocus />
        </Field>
        <Field label="Details">
          <textarea rows={4} value={details} maxLength={4000} onChange={(e) => setDetails(e.target.value)} />
        </Field>
        <div className="as-two">
          <Field label="Due date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Time (optional)">
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <div className="as-two">
          <Field label="List" hint="For example a client or mandate name">
            <input
              value={list}
              maxLength={60}
              list={listsId}
              placeholder="No list"
              onChange={(e) => setList(e.target.value)}
            />
          </Field>
          <Field
            label="Repeat"
            hint={repeat !== 'none' && !date ? 'Repeats from the day it is done' : undefined}
          >
            <select value={repeat} onChange={(e) => setRepeat(e.target.value as TodoRepeat)}>
              {TODO_REPEATS.map((r) => (
                <option key={r} value={r}>
                  {TODO_REPEAT_LABELS[r]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <datalist id={listsId}>
          {lists.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
        {todo.status !== 'done' && (
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value as TodoStatus)}>
              <option value="open">To do</option>
              <option value="doing">Doing</option>
            </select>
          </Field>
        )}
        <Toggle pressed={high} onChange={setHigh}>
          High priority
        </Toggle>
        <InlineError message={error} />
      </form>
    </Modal>
  );
}

function MoveToMandate({
  todo,
  onClose,
  onMoved,
}: {
  todo: Todo;
  onClose: () => void;
  onMoved: (t: Todo) => void;
}) {
  const { me, notify } = useAssistant();
  const data = useLoad(async () => {
    const [targets, members] = await Promise.all([
      callModule<MandateTarget[]>('workflow', 'meetings.targets', {}),
      core<Member[]>('members.list').catch(() => [] as Member[]),
    ]);
    return { targets, members: members.filter((m) => m.active) };
  });
  const [query, setQuery] = useState(todo.list);
  const [matterId, setMatterId] = useState('');
  const [assignee, setAssignee] = useState(me?.email ?? '');
  const [dueDate, setDueDate] = useState(todo.dueAt ? istParts(todo.dueAt).date : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const id = useId();
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, MandateTarget[]>();
    const all = (data.data?.targets ?? []).filter((t) => t.status !== 'closed');
    // A list name that matches nothing should not hide every mandate.
    const matches = all.filter((t) => !q || (t.title + ' ' + t.clientName).toLowerCase().includes(q));
    for (const t of matches.length || query !== todo.list ? matches : all)
      map.set(t.clientName, [...(map.get(t.clientName) ?? []), t]);
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [data.data, query, todo.list]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!matterId) return setError('Choose a mandate.');
    setBusy(true);
    setError('');
    try {
      const r = await assistant('todo.toTask', {
        id: todo.id,
        matterId,
        assignee: assignee || null,
        dueDate: dueDate || null,
      });
      onMoved(r.todo);
      notify('Task created on the mandate. The to-do is marked done.');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Move to a mandate"
      subtitle={todo.title}
      onClose={onClose}
      footer={
        <div className="wf-form-actions as-actions-end">
          <button type="button" className="button ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form={id}
            className="button primary"
            disabled={busy || data.phase !== 'ready'}
          >
            {busy ? 'Creating task' : 'Create task'}
          </button>
        </div>
      }
    >
      {data.phase === 'loading' ? (
        <Loading>Loading your mandates</Loading>
      ) : data.phase === 'error' ? (
        <InlineError message={data.error} onRetry={data.retry} />
      ) : (
        <form id={id} onSubmit={submit}>
          <p className="wf-caption">
            This creates a task on the mandate, where the usual task rules apply, and marks the to-do done.
          </p>
          <Field label="Find a mandate">
            <input
              type="search"
              value={query}
              placeholder="Client or mandate name"
              onChange={(e) => setQuery(e.target.value)}
              data-autofocus
            />
          </Field>
          <Field label="Mandate">
            <select value={matterId} onChange={(e) => setMatterId(e.target.value)} required>
              <option value="">{groups.length ? 'Choose a mandate' : 'No mandates match'}</option>
              {groups.map(([client, list]) => (
                <optgroup key={client} label={client}>
                  {list.map((t) => (
                    <option key={t.matterId} value={t.matterId}>
                      {t.title}
                      {t.restricted ? ' (restricted)' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          <div className="as-two">
            <Field label="Assign to">
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">Not assigned yet</option>
                {(data.data?.members ?? []).map((m) => (
                  <option key={m.email} value={m.email}>
                    {m.email === me?.email ? `${m.name} (me)` : m.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Due date">
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          </div>
          <InlineError message={error} />
        </form>
      )}
    </Modal>
  );
}

interface ItemActions {
  onStatus: (t: Todo, status: TodoStatus) => void;
  onEdit: (t: Todo) => void;
  onMove: (t: Todo) => void;
  onDelete: (t: Todo) => Promise<unknown>;
}

function DeleteButton({ todo, onDelete }: { todo: Todo; onDelete: ItemActions['onDelete'] }) {
  // A to-do from an email or a meeting is dismissed, so it is not added again.
  const sourced = todo.source === 'mail' || todo.source === 'commitment' || todo.source === 'meeting';
  return (
    <ConfirmButton
      className="wf-icon-btn as-tap"
      ariaLabel={(sourced ? 'Dismiss ' : 'Delete ') + todo.title}
      question={sourced ? 'Dismiss?' : 'Delete?'}
      confirmLabel={sourced ? 'Dismiss' : 'Delete'}
      onConfirm={() => onDelete(todo)}
    >
      <Trash2 size={16} />
    </ConfirmButton>
  );
}

function TodoItem({ todo, actions }: { todo: Todo; actions: ItemActions }) {
  const id = useId();
  const done = todo.status === 'done';
  return (
    <li
      className={
        'as-item' +
        (done ? ' done' : '') +
        (todo.priority === 'high' && !done ? ' high' : '') +
        (todo.critical && !done ? ' critical' : '')
      }
    >
      <input
        id={id}
        type="checkbox"
        className="as-check"
        checked={done}
        onChange={(e) => actions.onStatus(todo, e.target.checked ? 'done' : 'open')}
        aria-describedby={id + '-meta'}
      />
      <div className="as-item-main">
        <label htmlFor={id} className="as-item-title">
          {todo.title}
        </label>
        {todo.details && <p className="as-item-details">{todo.details}</p>}
        <TodoMeta todo={todo} id={id + '-meta'} />
      </div>
      <div className="as-item-actions">
        {!done && (
          <>
            <button
              type="button"
              className="wf-icon-btn as-tap"
              aria-label={'Edit ' + todo.title}
              onClick={() => actions.onEdit(todo)}
            >
              <Pencil size={16} />
            </button>
            <button
              type="button"
              className="wf-icon-btn as-tap"
              aria-label={'Move to a mandate: ' + todo.title}
              title="Move to a mandate"
              onClick={() => actions.onMove(todo)}
            >
              <BriefcaseBusiness size={16} />
            </button>
          </>
        )}
        <DeleteButton todo={todo} onDelete={actions.onDelete} />
      </div>
    </li>
  );
}

// A card on the board. Moving works with the buttons (keyboard and touch) or by dragging.
function BoardCard({ todo, actions }: { todo: Todo; actions: ItemActions }) {
  const id = useId();
  const s = todo.status;
  return (
    <li
      className={
        'as-board-card' + (todo.critical && s !== 'done' ? ' critical' : '') + (s === 'done' ? ' done' : '')
      }
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', todo.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      aria-labelledby={id}
      aria-describedby={id + '-meta'}
    >
      <p className="as-board-title" id={id}>
        {todo.title}
      </p>
      <TodoMeta todo={todo} id={id + '-meta'} board />
      <div className="as-board-actions">
        {s === 'open' && (
          <button
            type="button"
            className="button secondary small"
            onClick={() => actions.onStatus(todo, 'doing')}
          >
            Start <ArrowRight size={13} aria-hidden="true" />
            <span className="wf-sr">: {todo.title}</span>
          </button>
        )}
        {s === 'doing' && (
          <>
            <button
              type="button"
              className="button ghost small"
              onClick={() => actions.onStatus(todo, 'open')}
            >
              <ArrowLeft size={13} aria-hidden="true" /> To do<span className="wf-sr">: {todo.title}</span>
            </button>
            <button
              type="button"
              className="button secondary small"
              onClick={() => actions.onStatus(todo, 'done')}
            >
              <Check size={13} aria-hidden="true" /> Done<span className="wf-sr">: {todo.title}</span>
            </button>
          </>
        )}
        {s === 'done' && (
          <button type="button" className="button ghost small" onClick={() => actions.onStatus(todo, 'open')}>
            <RotateCcw size={13} aria-hidden="true" /> Reopen<span className="wf-sr">: {todo.title}</span>
          </button>
        )}
        <span className="as-board-tools">
          {s !== 'done' && (
            <button
              type="button"
              className="wf-icon-btn as-tap"
              aria-label={'Edit ' + todo.title}
              onClick={() => actions.onEdit(todo)}
            >
              <Pencil size={15} />
            </button>
          )}
          <DeleteButton todo={todo} onDelete={actions.onDelete} />
        </span>
      </div>
    </li>
  );
}

function Board({ todos, actions }: { todos: Todo[]; actions: ItemActions }) {
  const [over, setOver] = useState<TodoStatus | null>(null);
  const [allDone, setAllDone] = useState(false);
  const columns: { status: TodoStatus; items: Todo[] }[] = [
    { status: 'open', items: todos.filter((t) => t.status === 'open').sort(byOrder) },
    { status: 'doing', items: todos.filter((t) => t.status === 'doing').sort(byOrder) },
    { status: 'done', items: todos.filter((t) => t.status === 'done').sort(byDone) },
  ];
  const drop = (status: TodoStatus) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const t = todos.find((x) => x.id === e.dataTransfer.getData('text/plain'));
    if (t && t.status !== status) actions.onStatus(t, status);
  };
  return (
    <div className="as-board">
      {columns.map((c) => {
        const shown = c.status === 'done' && !allDone ? c.items.slice(0, 8) : c.items;
        return (
          <section
            key={c.status}
            className={'as-board-col' + (over === c.status ? ' over' : '')}
            aria-labelledby={'as-board-' + c.status}
            onDragOver={(e) => {
              e.preventDefault();
              if (over !== c.status) setOver(c.status);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
            }}
            onDrop={drop(c.status)}
          >
            <h3 id={'as-board-' + c.status}>
              {STATUS_LABELS[c.status]}
              <span className="as-count">{c.items.length}</span>
            </h3>
            {c.items.length === 0 ? (
              <p className="as-board-empty">
                {c.status === 'open'
                  ? 'Nothing waiting.'
                  : c.status === 'doing'
                    ? 'Nothing in progress. Press Start on a to-do.'
                    : 'Nothing done yet.'}
              </p>
            ) : (
              <ul className="as-board-list" aria-label={STATUS_LABELS[c.status]}>
                {shown.map((t) => (
                  <BoardCard key={t.id} todo={t} actions={actions} />
                ))}
              </ul>
            )}
            {c.status === 'done' && c.items.length > shown.length && (
              <button type="button" className="wf-link as-tap" onClick={() => setAllDone(true)}>
                Show all {c.items.length}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}

function AddTodo({ onAdded, onUndone }: { onAdded: (t: Todo) => void; onUndone: (t: Todo) => void }) {
  const id = useId();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const quick = useQuickAdd({ onAdded, onUndone });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return setError('Type the to-do first.');
    setBusy(true);
    setError('');
    try {
      await quick.add(text.trim());
      setText('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="as-add" onSubmit={submit} aria-label="Add a to-do">
      <div className="as-add-row">
        <label htmlFor={id} className="wf-sr">
          New to-do
        </label>
        <input
          id={id}
          className="wf-input"
          value={text}
          maxLength={300}
          placeholder="Add a to-do"
          autoComplete="off"
          aria-describedby={id + '-hint'}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? 'Adding' : 'Add'}
        </button>
      </div>
      <div aria-live="polite">
        {quick.last && !text ? (
          <Understood quick={quick} />
        ) : (
          <p className="as-capture-hint" id={id + '-hint'}>
            Write it as you would say it, for example &ldquo;{QUICK_ADD_EXAMPLE}&rdquo;. Dates, times, #list,
            ! for high priority and &ldquo;every week&rdquo; are understood.
          </p>
        )}
      </div>
      <InlineError message={error} />
    </form>
  );
}

export function TodoSection({ view, onView }: { view: TodoView; onView: (v: TodoView) => void }) {
  const { notify } = useAssistant();
  const todos = useLoad(() => assistant('todos.list', { includeDone: true }));
  const [editing, setEditing] = useState<Todo | null>(null);
  const [moving, setMoving] = useState<Todo | null>(null);
  const [status, setStatus] = useState('');
  const [listFilter, setListFilter] = useState('');

  const put = (t: Todo) =>
    todos.set((list) =>
      list.some((x) => x.id === t.id) ? list.map((x) => (x.id === t.id ? t : x)) : [t, ...list],
    );
  const drop = (t: Todo) => todos.set((list) => list.filter((x) => x.id !== t.id));
  const conflict = () => {
    notify(CONFLICT);
    void todos.reload();
  };
  // A status change is shown at once and undone if the server refuses.
  const changeStatus = async (t: Todo, next: TodoStatus) => {
    put({ ...t, status: next, doneAt: next === 'done' ? nowMs() : null });
    try {
      const saved = await assistant('todo.update', {
        id: t.id,
        baseRevision: t.revision,
        todo: inputOf(t, { status: next }),
      });
      put(saved);
      if (next === 'done' && t.repeat !== 'none') {
        // Completing a repeating to-do creates the next one on the server.
        await todos.reload();
        setStatus(`Done: ${t.title}. The next one has been added.`);
        notify('Done. The next one has been added.');
      } else
        setStatus(
          next === 'done' ? `Done: ${t.title}` : next === 'doing' ? `Doing: ${t.title}` : `To do: ${t.title}`,
        );
    } catch (e) {
      put(t);
      if (isConflict(e)) conflict();
      else notify(errorMessage(e));
    }
  };
  const remove = async (t: Todo) => {
    try {
      await assistant('todo.delete', { id: t.id });
      drop(t);
      setStatus(`Removed: ${t.title}`);
    } catch (e) {
      notify(errorMessage(e));
    }
  };
  const actions: ItemActions = {
    onStatus: changeStatus,
    onEdit: setEditing,
    onMove: setMoving,
    onDelete: remove,
  };

  const data = todos.data;
  const lists = useMemo(() => {
    const all = data ?? [];
    const counts = new Map<string, number>();
    for (const t of all) if (t.list && t.status !== 'done') counts.set(t.list, (counts.get(t.list) ?? 0) + 1);
    for (const t of all) if (t.list && !counts.has(t.list)) counts.set(t.list, 0);
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [data]);

  if (todos.phase === 'loading') return <Loading>Loading your to-dos</Loading>;
  if (todos.phase === 'error' || !todos.data)
    return (
      <LoadError
        title="Your to-dos could not be loaded"
        message={todos.error}
        status={todos.status}
        onRetry={todos.retry}
      />
    );

  const all = todos.data;
  const filter = lists.some(([l]) => l === listFilter) || listFilter === NO_LIST ? listFilter : '';
  const shown = all.filter((t) => (filter === NO_LIST ? !t.list : !filter || t.list === filter));
  const active = shown.filter((t) => t.status !== 'done').sort(byOrder);
  const done = shown.filter((t) => t.status === 'done').sort(byDone);
  const openCount = (pred: (t: Todo) => boolean) => all.filter((t) => t.status !== 'done' && pred(t)).length;
  const critical = active.filter((t) => t.critical).length;

  return (
    <div className="as-stack">
      <AddTodo
        onAdded={(t) => {
          put(t);
          setStatus(`Added: ${t.title}`);
        }}
        onUndone={drop}
      />
      <div className="as-todo-tools">
        {lists.length > 0 ? (
          <Chips<string>
            label="Show list"
            value={filter}
            onChange={setListFilter}
            options={[
              { id: '', label: 'All', count: openCount(() => true) },
              ...lists.map(([l, n]) => ({ id: l, label: l, count: n })),
              ...(all.some((t) => !t.list && t.status !== 'done')
                ? [{ id: NO_LIST, label: 'No list', count: openCount((t) => !t.list) }]
                : []),
            ]}
          />
        ) : (
          <span />
        )}
        <Chips<TodoView>
          label="View"
          value={view}
          onChange={onView}
          options={[
            { id: 'list', label: 'List' },
            { id: 'board', label: 'Board' },
          ]}
        />
      </div>
      <p className="wf-sr" aria-live="polite">
        {status}
      </p>
      <InlineError message={todos.error} onRetry={todos.retry} />
      {critical > 0 && (
        <p className="as-critical-note">
          {critical === 1 ? '1 to-do is' : `${critical} to-dos are`} 3 or more days overdue. They are listed
          first and lead your brief until done, moved or re-dated.
        </p>
      )}
      {view === 'board' ? (
        <Board todos={shown} actions={actions} />
      ) : (
        <>
          {active.length === 0 ? (
            <Empty icon={ListTodo} title={filter ? 'Nothing open on this list' : 'No open to-dos'}>
              Add one above, or ask Aeka to note something for you.
            </Empty>
          ) : (
            <ul className="as-items" aria-label="Open to-dos">
              {active.map((t) => (
                <TodoItem key={t.id} todo={t} actions={actions} />
              ))}
            </ul>
          )}
          {done.length > 0 && (
            <details className="as-done">
              <summary>Done ({done.length})</summary>
              <ul className="as-items" aria-label="Done to-dos">
                {done.slice(0, 50).map((t) => (
                  <TodoItem key={t.id} todo={t} actions={actions} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {editing && (
        <TodoEditor
          todo={editing}
          lists={lists.map(([l]) => l)}
          onClose={() => setEditing(null)}
          onSaved={put}
          onConflict={conflict}
        />
      )}
      {moving && <MoveToMandate todo={moving} onClose={() => setMoving(null)} onMoved={put} />}
    </div>
  );
}
