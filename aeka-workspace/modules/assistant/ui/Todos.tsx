'use client';
// Personal to-dos: add, edit, complete, delete and move onto a mandate as a Workflow task.
import { useId, useMemo, useState, type FormEvent } from 'react';
import { BriefcaseBusiness, ListTodo, Pencil, Star, Trash2 } from 'lucide-react';
import { callModule } from '../../../core/client/api';
import { assistant } from '../shared/client';
import type { TodoInput } from '../shared/contract';
import type { Todo } from '../shared/types';
import { Modal } from '../../workflow/ui/components/Modal';
import { ConfirmButton } from '../../workflow/ui/components/ConfirmButton';
import { Empty, Toggle } from '../../workflow/ui/components/Bits';
import { Field } from '../../workflow/ui/components/Inputs';
import { useAssistant } from './context';
import { InlineError, LoadError, Loading } from './Bits';
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

const SOURCE_LABELS: Record<Todo['source'], string> = {
  manual: '',
  chat: 'From Ask Aeka',
  whatsapp: 'From WhatsApp',
  mail: 'From mail',
};

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

const byOrder = (a: Todo, b: Todo) =>
  (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1) ||
  (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) ||
  a.createdAt - b.createdAt;

function TodoEditor({
  todo,
  onClose,
  onSaved,
  onConflict,
}: {
  todo: Todo;
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
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { notify } = useAssistant();
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError('A to-do needs a title.');
    setBusy(true);
    setError('');
    try {
      const input: TodoInput = {
        title: title.trim(),
        details: details.trim(),
        priority: high ? 'high' : 'normal',
        dueAt: dueFrom(date, time),
        status: todo.status,
      };
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
  const [query, setQuery] = useState('');
  const [matterId, setMatterId] = useState('');
  const [assignee, setAssignee] = useState(me?.email ?? '');
  const [dueDate, setDueDate] = useState(todo.dueAt ? istParts(todo.dueAt).date : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const id = useId();
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, MandateTarget[]>();
    for (const t of data.data?.targets ?? []) {
      if (t.status === 'closed') continue;
      if (q && !(t.title + ' ' + t.clientName).toLowerCase().includes(q)) continue;
      map.set(t.clientName, [...(map.get(t.clientName) ?? []), t]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [data.data, query]);

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

function TodoItem({
  todo,
  onChange,
  onEdit,
  onMove,
  onDelete,
}: {
  todo: Todo;
  onChange: (t: Todo, status: Todo['status']) => void;
  onEdit: () => void;
  onMove: () => void;
  onDelete: () => Promise<unknown>;
}) {
  const id = useId();
  const done = todo.status === 'done';
  const now = useClock();
  const overdue = !done && todo.dueAt != null && todo.dueAt < now;
  return (
    <li className={'as-item' + (done ? ' done' : '') + (todo.priority === 'high' && !done ? ' high' : '')}>
      <input
        id={id}
        type="checkbox"
        className="as-check"
        checked={done}
        onChange={(e) => onChange(todo, e.target.checked ? 'done' : 'open')}
        aria-describedby={id + '-meta'}
      />
      <div className="as-item-main">
        <label htmlFor={id} className="as-item-title">
          {todo.title}
        </label>
        {todo.details && <p className="as-item-details">{todo.details}</p>}
        <p className="as-item-meta" id={id + '-meta'}>
          {todo.priority === 'high' && !done && (
            <span className="as-flag">
              <Star size={12} aria-hidden="true" /> High priority
            </span>
          )}
          {todo.dueAt != null && !done && (
            <span className={overdue ? 'wf-overdue' : ''}>
              {overdue ? 'Overdue: ' : 'Due '}
              {formatWhen(todo.dueAt)}
            </span>
          )}
          {done && todo.doneAt && <span>Done {formatWhen(todo.doneAt)}</span>}
          {todo.taskId && <span className="as-tag">Moved to a mandate</span>}
          {SOURCE_LABELS[todo.source] && <span>{SOURCE_LABELS[todo.source]}</span>}
        </p>
      </div>
      <div className="as-item-actions">
        {!done && (
          <>
            <button
              type="button"
              className="wf-icon-btn as-tap"
              aria-label={'Edit ' + todo.title}
              onClick={onEdit}
            >
              <Pencil size={16} />
            </button>
            <button
              type="button"
              className="wf-icon-btn as-tap"
              aria-label={'Move to a mandate: ' + todo.title}
              title="Move to a mandate"
              onClick={onMove}
            >
              <BriefcaseBusiness size={16} />
            </button>
          </>
        )}
        <ConfirmButton
          className="wf-icon-btn as-tap"
          ariaLabel={'Delete ' + todo.title}
          question="Delete?"
          onConfirm={onDelete}
        >
          <Trash2 size={16} />
        </ConfirmButton>
      </div>
    </li>
  );
}

function AddTodo({ onAdded }: { onAdded: (t: Todo) => void }) {
  const id = useId();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [high, setHigh] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError('Type the to-do first.');
    setBusy(true);
    setError('');
    try {
      const t = await assistant('todo.create', {
        todo: {
          title: title.trim(),
          details: '',
          priority: high ? 'high' : 'normal',
          dueAt: dueFrom(date, time),
        },
      });
      onAdded(t);
      setTitle('');
      setDate('');
      setTime('');
      setHigh(false);
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
          value={title}
          maxLength={300}
          placeholder="Add a to-do"
          autoComplete="off"
          onChange={(e) => setTitle(e.target.value)}
        />
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? 'Adding' : 'Add'}
        </button>
      </div>
      <div className="as-add-row small">
        <label className="as-mini">
          <span>Due</span>
          <input type="date" className="wf-input" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="as-mini">
          <span>Time</span>
          <input type="time" className="wf-input" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <Toggle pressed={high} onChange={setHigh}>
          High priority
        </Toggle>
      </div>
      <InlineError message={error} />
    </form>
  );
}

export function TodoSection() {
  const { notify } = useAssistant();
  const todos = useLoad(() => assistant('todos.list', { includeDone: true }));
  const [editing, setEditing] = useState<Todo | null>(null);
  const [moving, setMoving] = useState<Todo | null>(null);
  const [status, setStatus] = useState('');

  const put = (t: Todo) =>
    todos.set((list) =>
      list.some((x) => x.id === t.id) ? list.map((x) => (x.id === t.id ? t : x)) : [t, ...list],
    );
  const conflict = () => {
    notify(CONFLICT);
    void todos.reload();
  };
  // Completing is shown at once and undone if the server refuses.
  const setDone = async (t: Todo, next: Todo['status']) => {
    put({ ...t, status: next, doneAt: next === 'done' ? nowMs() : null });
    try {
      const saved = await assistant('todo.update', {
        id: t.id,
        baseRevision: t.revision,
        todo: { title: t.title, details: t.details, priority: t.priority, dueAt: t.dueAt, status: next },
      });
      put(saved);
      setStatus(next === 'done' ? `Done: ${t.title}` : `Reopened: ${t.title}`);
    } catch (e) {
      put(t);
      if (isConflict(e)) conflict();
      else notify(errorMessage(e));
    }
  };
  const remove = async (t: Todo) => {
    try {
      await assistant('todo.delete', { id: t.id });
      todos.set((list) => list.filter((x) => x.id !== t.id));
      setStatus(`Deleted: ${t.title}`);
    } catch (e) {
      notify(errorMessage(e));
    }
  };

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
  const open = todos.data.filter((t) => t.status === 'open').sort(byOrder);
  const done = todos.data
    .filter((t) => t.status === 'done')
    .sort((a, b) => (b.doneAt ?? b.updatedAt) - (a.doneAt ?? a.updatedAt));
  const item = (t: Todo) => (
    <TodoItem
      key={t.id}
      todo={t}
      onChange={setDone}
      onEdit={() => setEditing(t)}
      onMove={() => setMoving(t)}
      onDelete={() => remove(t)}
    />
  );
  return (
    <div className="as-stack">
      <AddTodo
        onAdded={(t) => {
          put(t);
          setStatus(`Added: ${t.title}`);
        }}
      />
      <p className="wf-sr" aria-live="polite">
        {status}
      </p>
      <InlineError message={todos.error} onRetry={todos.retry} />
      {open.length === 0 ? (
        <Empty icon={ListTodo} title="No open to-dos">
          Add one above, or ask Aeka to note something for you.
        </Empty>
      ) : (
        <ul className="as-items" aria-label="Open to-dos">
          {open.map(item)}
        </ul>
      )}
      {done.length > 0 && (
        <details className="as-done">
          <summary>Done ({done.length})</summary>
          <ul className="as-items" aria-label="Done to-dos">
            {done.slice(0, 50).map(item)}
          </ul>
        </details>
      )}
      {editing && (
        <TodoEditor todo={editing} onClose={() => setEditing(null)} onSaved={put} onConflict={conflict} />
      )}
      {moving && <MoveToMandate todo={moving} onClose={() => setMoving(null)} onMoved={put} />}
    </div>
  );
}
