'use client';
// Tasks: list, by client and by person views, filters, quick add and the task drawer.
import { useMemo, useState } from 'react';
import { ListChecks, Plus, Search } from 'lucide-react';
import { MATTER_STAGES, TASK_STATUSES, type PersonKey, type Task } from '../shared/types';
import { Chips, Empty } from './components/Bits';
import { DateInput, Field } from './components/Inputs';
import { PersonBadge, PersonPicker, usePeopleOptions } from './components/People';
import { byTaskOrder, isDone, personLabel, plural, rank, weekStart, addDays, type Nav } from './lib';
import { useWF } from './store';
import { TaskDrawer } from './TaskDrawer';
import { TaskRow } from './TaskRow';
import { useTaskActions } from './taskActions';

type View = 'list' | 'client' | 'person';
type Due = 'any' | 'overdue' | 'week' | 'none';

export function useOpeners(navigate: Nav) {
  const { setFocusMatter, setFocusTask } = useWF();
  return {
    openTask: (id: string | null) => setFocusTask(id),
    openMatter: (id: string) => {
      setFocusTask(null);
      setFocusMatter(id);
      navigate('workflow/matters');
    },
  };
}

export function TasksPage({ navigate }: { navigate: Nav }) {
  const { tasks, clients, matterById, clientById, members, meEmail, today, focusTask } = useWF();
  const { openTask, openMatter } = useOpeners(navigate);
  const [view, setView] = useState<View>('list');
  const [search, setSearch] = useState('');
  const [person, setPerson] = useState<string>('all');
  const [status, setStatus] = useState<string>('open');
  const [client, setClient] = useState('all');
  const [due, setDue] = useState<Due>('any');
  const people = usePeopleOptions(tasks.map((t) => t.assignee));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const wStart = weekStart(today),
      wEnd = addDays(wStart, 6);
    return tasks.filter((t) => {
      const m = matterById.get(t.matterId);
      if (client !== 'all' && m?.clientId !== client) return false;
      if (view !== 'person') {
        if (person === 'none' && t.assignee) return false;
        if (person !== 'all' && person !== 'none' && t.assignee !== person) return false;
      }
      if (status === 'open' && isDone(t)) return false;
      if (status !== 'open' && status !== 'all' && t.status !== status) return false;
      if (due === 'overdue' && (isDone(t) || !t.dueDate || t.dueDate >= today)) return false;
      if (due === 'week' && (!t.dueDate || t.dueDate < wStart || t.dueDate > wEnd)) return false;
      if (due === 'none' && t.dueDate) return false;
      if (!q) return true;
      const hay = [
        t.title,
        t.status,
        t.notes,
        m?.title,
        clientById.get(m?.clientId ?? '')?.name,
        personLabel(t.assignee, members).name,
        personLabel(t.assignee, members).initials,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [tasks, search, person, status, client, due, view, today, matterById, clientById, members]);

  const review = tasks
    .filter((t) => t.status === 'In Review' && t.reviewedBy === meEmail)
    .sort(byTaskOrder);
  const open = filtered.filter((t) => !isDone(t)).sort(byTaskOrder);
  const done = filtered.filter(isDone).sort((a, b) => b.updatedAt - a.updatedAt);
  const rowProps = { onOpen: openTask, onOpenMatter: openMatter };

  return (
    <div className="wf-stack">
      <QuickAdd />
      {review.length > 0 && (
        <section className="card wf-section tinted" aria-labelledby="wf-review-h">
          <h2 id="wf-review-h">Awaiting my review ({review.length})</h2>
          <ul className="wf-task-list">
            {review.map((t) => (
              <TaskRow key={t.id} task={t} {...rowProps} />
            ))}
          </ul>
        </section>
      )}
      <section className="card wf-section" aria-label="Tasks">
        <div className="wf-toolbar">
          <Chips
            label="View"
            value={view}
            onChange={setView}
            options={[
              { id: 'list', label: 'List' },
              { id: 'client', label: 'By client' },
              { id: 'person', label: 'By person' },
            ]}
          />
          <label className="search-box wf-search">
            <Search size={16} aria-hidden="true" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks, clients, mandates or people"
              aria-label="Search tasks"
            />
          </label>
        </div>
        <div className="wf-filters">
          {view !== 'person' && (
            <Field label="Person">
              <select value={person} onChange={(e) => setPerson(e.target.value)}>
                <option value="all">Everyone</option>
                <option value="none">Unassigned</option>
                {people.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="open">All open</option>
              <option value="all">All, including completed</option>
              {TASK_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Client">
            <select value={client} onChange={(e) => setClient(e.target.value)}>
              <option value="all">All clients</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Due">
            <select value={due} onChange={(e) => setDue(e.target.value as Due)}>
              <option value="any">Any date</option>
              <option value="overdue">Overdue</option>
              <option value="week">This week</option>
              <option value="none">No due date</option>
            </select>
          </Field>
        </div>

        {!filtered.length ? (
          <Empty icon={ListChecks} title="No tasks match">
            {tasks.length ? 'Change the filters or the search to see more tasks.' : 'Add the first task above.'}
          </Empty>
        ) : view === 'list' ? (
          <>
            <ul className="wf-task-list">
              {open.map((t) => (
                <TaskRow key={t.id} task={t} {...rowProps} />
              ))}
            </ul>
            {!open.length && status !== 'Completed' && <p className="wf-empty-line">No open tasks match.</p>}
            {done.length > 0 && (
              <>
                <h3 className="wf-h3 wf-pad">Completed ({done.length})</h3>
                <ul className="wf-task-list">
                  {done.map((t) => (
                    <TaskRow key={t.id} task={t} {...rowProps} />
                  ))}
                </ul>
              </>
            )}
          </>
        ) : view === 'client' ? (
          <ByClient tasks={filtered} rowProps={rowProps} />
        ) : (
          <ByPerson tasks={filtered} rowProps={rowProps} />
        )}
      </section>
      {focusTask && (
        <TaskDrawer taskId={focusTask} onClose={() => openTask(null)} onOpenMatter={openMatter} />
      )}
    </div>
  );
}

type RowProps = { onOpen: (id: string) => void; onOpenMatter: (id: string) => void };

function ByClient({ tasks, rowProps }: { tasks: Task[]; rowProps: RowProps }) {
  const { matterById, clientById } = useWF();
  const groups = new Map<string, Task[]>();
  for (const t of tasks) {
    const c = matterById.get(t.matterId)?.clientId ?? '';
    groups.set(c, [...(groups.get(c) ?? []), t]);
  }
  const sorted = [...groups.entries()]
    .map(([id, list]) => ({ id, list, open: list.filter((t) => !isDone(t)).length }))
    .sort((a, b) => b.open - a.open || b.list.length - a.list.length);
  return (
    <div className="wf-groups">
      {sorted.map((g) => (
        <section key={g.id} className="wf-group" aria-label={clientById.get(g.id)?.name}>
          <h3>
            {clientById.get(g.id)?.name ?? 'Unknown client'}
            <span className="wf-caption">
              {g.open} open, {g.list.length} in all
            </span>
          </h3>
          <ul className="wf-task-list">
            {[...g.list].sort((a, b) => Number(isDone(a)) - Number(isDone(b)) || byTaskOrder(a, b)).map((t) => (
              <TaskRow key={t.id} task={t} {...rowProps} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// Each task appears once, under its assignee.
function ByPerson({ tasks, rowProps }: { tasks: Task[]; rowProps: RowProps }) {
  const { members, meEmail } = useWF();
  const groups = new Map<PersonKey, Task[]>();
  for (const t of tasks) groups.set(t.assignee ?? '', [...(groups.get(t.assignee ?? '') ?? []), t]);
  const order = (k: PersonKey) => {
    if (!k) return 1e6;
    const m = members.find((x) => x.email === k);
    return k === meEmail ? -1 : m ? 10 - rank(m) : 100;
  };
  const keys = [...groups.keys()].sort(
    (a, b) => order(a) - order(b) || personLabel(a, members).name.localeCompare(personLabel(b, members).name),
  );
  return (
    <div className="wf-groups">
      {keys.map((k) => {
        const list = groups.get(k)!;
        const p = personLabel(k || null, members);
        const open = list.filter((t) => !isDone(t)).length;
        return (
          <section key={k || 'none'} className="wf-group" aria-label={p.name}>
            <h3>
              <PersonBadge person={k || null} showName />
              {p.member && <span className="wf-caption">{p.member.designation}</span>}
              <span className="wf-caption">
                {open} open, {plural(list.length, 'task')} in all
              </span>
            </h3>
            <ul className="wf-task-list">
              {[...list].sort((a, b) => Number(isDone(a)) - Number(isDone(b)) || byTaskOrder(a, b)).map((t) => (
                <TaskRow key={t.id} task={t} {...rowProps} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

const NEW = '__new';

function QuickAdd() {
  const { clients, matters, caps, meEmail, run, dispatch, notify } = useWF();
  const actions = useTaskActions();
  const [title, setTitle] = useState('');
  const [clientId, setClientId] = useState('');
  const [matterId, setMatterId] = useState('');
  const [newMatter, setNewMatter] = useState('');
  const [assignee, setAssignee] = useState<PersonKey | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cid = clientId || clients[0]?.id || '';
  const options = matters.filter((m) => m.clientId === cid && m.status !== 'closed');
  const mid = matterId === NEW ? NEW : options.some((m) => m.id === matterId) ? matterId : (options[0]?.id ?? '');

  if (!clients.length)
    return (
      <p className="wf-note">
        Tasks belong to a mandate. Add a client and a mandate under Clients and Mandates first.
      </p>
    );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!title.trim()) return setError('Enter the task.');
    if (!mid) return setError('Choose a mandate.');
    if (mid === NEW && !newMatter.trim()) return setError('Enter a title for the new mandate.');
    setBusy(true);
    let target = mid;
    if (mid === NEW) {
      const created = await run(
        'matter.create',
        {
          matter: {
            clientId: cid,
            title: newMatter.trim(),
            type: 'Other',
            status: 'active',
            stage: MATTER_STAGES[0],
            priority: false,
            note: '',
            team: [assignee || meEmail].filter(Boolean),
            restricted: false,
            peerFeedbackVisible: false,
            isDeal: false,
          },
        },
        { onError: setError },
      );
      if (!created) return setBusy(false);
      dispatch({ type: 'matter', matter: created });
      target = created.id;
      setMatterId(created.id);
      setNewMatter('');
    }
    const saved = await actions.create({ matterId: target, title: title.trim(), assignee, dueDate }, { onError: setError });
    setBusy(false);
    if (saved) {
      setTitle('');
      setDueDate(null);
      notify('Task added');
    }
  };

  return (
    <form className="card wf-section wf-quick" onSubmit={submit} aria-labelledby="wf-quick-h">
      <h2 id="wf-quick-h">Add a task</h2>
      <div className="wf-quick-grid">
        <Field label="Task">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="For example, draft the s.56 note" />
        </Field>
        <Field label="Client">
          <select
            value={cid}
            onChange={(e) => {
              setClientId(e.target.value);
              setMatterId('');
            }}
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Mandate">
          <select value={mid} onChange={(e) => setMatterId(e.target.value)}>
            {!options.length && mid !== NEW && <option value="">No open mandates</option>}
            {options.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
            {caps.manageMatters && <option value={NEW}>New mandate</option>}
          </select>
        </Field>
        {mid === NEW && (
          <Field label="New mandate title">
            <input value={newMatter} onChange={(e) => setNewMatter(e.target.value)} />
          </Field>
        )}
        <PersonPicker label="Assign to" value={assignee} onChange={setAssignee} />
        <DateInput label="Due date" value={dueDate} onChange={setDueDate} />
        <div className="wf-quick-submit">
          <button type="submit" className="button primary" disabled={busy}>
            <Plus size={15} /> Add task
          </button>
        </div>
      </div>
      {error && (
        <p className="wf-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
