'use client';
// Deadlines: upcoming milestones grouped by month with an overdue section, filters and, for Assistant
// Managers and above, add, edit, complete and delete. Also provides the mandate Deadlines tab.
import { useState } from 'react';
import { CalendarClock, CircleCheck, Circle, Pencil, Plus, Trash2 } from 'lucide-react';
import type { MilestoneInput } from '../shared/contract';
import { MILESTONE_KINDS, type Milestone, type MilestoneKind } from '../shared/types';
import { Empty, StatusPill, Toggle } from './components/Bits';
import { ConfirmButton } from './components/ConfirmButton';
import { DateInput, Field } from './components/Inputs';
import { Modal } from './components/Modal';
import { PersonBadge, PersonPicker } from './components/People';
import { formatDate, formatMonth, type Nav } from './lib';
import { MatterSelect } from './TimePage';
import { useMatterLabel, useWF } from './store';

const READ_ONLY_NOTE = 'Deadlines are added and changed by Assistant Managers and above.';

export function DeadlinesPage({ navigate }: { navigate: Nav }) {
  const { milestones, clients, matterById, caps, goToMatter } = useWF();
  const [client, setClient] = useState('all');
  const [kind, setKind] = useState('all');
  const [showDone, setShowDone] = useState(false);
  const [adding, setAdding] = useState(false);
  const list = milestones.filter(
    (m) =>
      (client === 'all' || matterById.get(m.matterId)?.clientId === client) &&
      (kind === 'all' || m.kind === kind) &&
      (showDone || !m.done),
  );
  return (
    <div className="wf-stack">
      <div className="wf-toolbar">
        <div className="wf-filters">
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
          <Field label="Kind">
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="all">All kinds</option>
              {MILESTONE_KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </Field>
          <div className="wf-field">
            <span>Completed</span>
            <Toggle pressed={showDone} onChange={setShowDone}>
              Show completed
            </Toggle>
          </div>
        </div>
        {caps.manageMatters && (
          <button type="button" className="button primary" onClick={() => setAdding(true)}>
            <Plus size={15} /> Add deadline
          </button>
        )}
      </div>
      {!caps.manageMatters && <p className="wf-note">{READ_ONLY_NOTE}</p>}
      {!list.length ? (
        <Empty icon={CalendarClock} title="No deadlines">
          {milestones.length
            ? 'No deadlines match the filters.'
            : 'Filings, signings and client meetings appear here once added.'}
        </Empty>
      ) : (
        <div className="card wf-section">
          <MilestoneGroups
            list={list}
            showMatter
            onOpenMatter={(id) => {
              goToMatter(id);
              navigate('workflow/matters');
            }}
          />
        </div>
      )}
      {adding && <MilestoneForm onClose={() => setAdding(false)} />}
    </div>
  );
}

// The mandate Deadlines tab.
export function MilestoneList({ matterId }: { matterId: string }) {
  const { milestones, caps } = useWF();
  const [showDone, setShowDone] = useState(true);
  const [adding, setAdding] = useState(false);
  const list = milestones.filter((m) => m.matterId === matterId && (showDone || !m.done));
  return (
    <>
      <div className="wf-row wf-between wf-wrap">
        <Toggle pressed={showDone} onChange={setShowDone}>
          Show completed
        </Toggle>
        {caps.manageMatters && (
          <button type="button" className="button primary" onClick={() => setAdding(true)}>
            <Plus size={15} /> Add deadline
          </button>
        )}
      </div>
      {!caps.manageMatters && <p className="wf-caption">{READ_ONLY_NOTE}</p>}
      {list.length ? (
        <MilestoneGroups list={list} />
      ) : (
        <p className="wf-empty-line">No deadlines on this mandate.</p>
      )}
      {adding && <MilestoneForm matterId={matterId} onClose={() => setAdding(false)} />}
    </>
  );
}

function MilestoneGroups({
  list,
  showMatter,
  onOpenMatter,
}: {
  list: Milestone[];
  showMatter?: boolean;
  onOpenMatter?: (id: string) => void;
}) {
  const { today } = useWF();
  const sorted = [...list].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const overdue = sorted.filter((m) => !m.done && m.dueDate < today);
  const rest = sorted.filter((m) => !overdue.includes(m));
  const months = new Map<string, Milestone[]>();
  for (const m of rest) {
    const k = m.dueDate.slice(0, 7);
    months.set(k, [...(months.get(k) ?? []), m]);
  }
  return (
    <div className="wf-groups">
      {overdue.length > 0 && (
        <section aria-label="Overdue" className="wf-group overdue">
          <h3>Overdue ({overdue.length})</h3>
          <ul className="wf-list">
            {overdue.map((m) => (
              <MilestoneRow key={m.id} m={m} showMatter={showMatter} onOpenMatter={onOpenMatter} />
            ))}
          </ul>
        </section>
      )}
      {[...months.entries()].map(([k, items]) => (
        <section key={k} aria-label={formatMonth(k + '-01')} className="wf-group">
          <h3>{formatMonth(k + '-01')}</h3>
          <ul className="wf-list">
            {items.map((m) => (
              <MilestoneRow key={m.id} m={m} showMatter={showMatter} onOpenMatter={onOpenMatter} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function MilestoneRow({
  m,
  showMatter,
  onOpenMatter,
}: {
  m: Milestone;
  showMatter?: boolean;
  onOpenMatter?: (id: string) => void;
}) {
  const { caps, run, dispatch, today, notify } = useWF();
  const label = useMatterLabel();
  const [editing, setEditing] = useState(false);
  const overdue = !m.done && m.dueDate < today;
  const toggle = async () => {
    const saved = await run('milestone.update', {
      id: m.id,
      milestone: {
        matterId: m.matterId,
        title: m.title,
        kind: m.kind,
        dueDate: m.dueDate,
        done: !m.done,
        owner: m.owner,
      },
      baseRevision: m.revision,
    });
    if (saved) dispatch({ type: 'milestone', milestone: saved });
  };
  return (
    <li className={'wf-list-row wf-milestone' + (m.done ? ' done' : '')}>
      {caps.manageMatters ? (
        <button
          type="button"
          className="wf-icon-btn wf-done-btn"
          aria-pressed={m.done}
          aria-label={m.done ? `Reopen ${m.title}` : `Mark ${m.title} complete`}
          onClick={() => void toggle()}
        >
          {m.done ? <CircleCheck size={20} /> : <Circle size={20} />}
        </button>
      ) : (
        <span className="wf-done-btn" aria-hidden="true">
          {m.done ? <CircleCheck size={20} /> : <Circle size={20} />}
        </span>
      )}
      <div className="wf-date-block">
        <strong className={overdue ? 'wf-overdue' : ''}>{formatDate(m.dueDate)}</strong>
      </div>
      <div className="wf-grow">
        <strong className="wf-milestone-title">{m.title}</strong>
        <div className="wf-task-meta">
          <StatusPill value={m.kind} tone={m.kind === 'Statutory Filing' ? 'red' : 'tint'} />
          {overdue && <StatusPill value="overdue" label="Overdue" />}
          {m.done && <StatusPill value="Completed" label="Completed" />}
          {showMatter &&
            (onOpenMatter ? (
              <button type="button" className="wf-link" onClick={() => onOpenMatter(m.matterId)}>
                {label(m.matterId)}
              </button>
            ) : (
              <span>{label(m.matterId)}</span>
            ))}
          {m.owner && (
            <span className="wf-inline-person">
              Owner <PersonBadge person={m.owner} />
            </span>
          )}
        </div>
      </div>
      {caps.manageMatters && (
        <div className="wf-row">
          <button
            type="button"
            className="wf-icon-btn"
            aria-label={`Edit ${m.title}`}
            onClick={() => setEditing(true)}
          >
            <Pencil size={15} />
          </button>
          <ConfirmButton
            className="wf-icon-btn"
            ariaLabel={`Delete ${m.title}`}
            question="Delete this deadline?"
            onConfirm={async () => {
              if (await run('milestone.delete', { id: m.id })) {
                dispatch({ type: 'milestoneGone', id: m.id });
                notify('Deadline deleted');
              }
            }}
          >
            <Trash2 size={15} />
          </ConfirmButton>
        </div>
      )}
      {editing && <MilestoneForm milestone={m} onClose={() => setEditing(false)} />}
    </li>
  );
}

export function MilestoneForm({
  milestone,
  matterId,
  onClose,
}: {
  milestone?: Milestone;
  matterId?: string;
  onClose: () => void;
}) {
  const { run, dispatch, notify } = useWF();
  const [m, setM] = useState<MilestoneInput>(
    milestone
      ? {
          matterId: milestone.matterId,
          title: milestone.title,
          kind: milestone.kind,
          dueDate: milestone.dueDate,
          done: milestone.done,
          owner: milestone.owner,
        }
      : { matterId: matterId ?? '', title: '', kind: 'Deadline', dueDate: '', done: false, owner: null },
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof MilestoneInput>(k: K, v: MilestoneInput[K]) => setM((x) => ({ ...x, [k]: v }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!m.matterId) return setError('Choose a mandate.');
    if (!m.title.trim()) return setError('Enter the filing or event.');
    if (!m.dueDate) return setError('Choose the due date.');
    setBusy(true);
    const input = { ...m, title: m.title.trim() };
    const saved = milestone
      ? await run(
          'milestone.update',
          { id: milestone.id, milestone: input, baseRevision: milestone.revision },
          { onError: setError },
        )
      : await run('milestone.create', { milestone: input }, { onError: setError });
    setBusy(false);
    if (saved) {
      dispatch({ type: 'milestone', milestone: saved });
      notify(milestone ? 'Deadline updated' : 'Deadline added');
      onClose();
    }
  };
  return (
    <Modal title={milestone ? 'Edit deadline' : 'Add a deadline'} onClose={onClose}>
      <form onSubmit={submit}>
        {!matterId && !milestone && <MatterSelect value={m.matterId} onChange={(v) => set('matterId', v)} />}
        <Field label="Filing or event">
          <input
            value={m.title}
            onChange={(e) => set('title', e.target.value)}
            data-autofocus
            maxLength={200}
            placeholder="For example, Form FC-TRS filing"
          />
        </Field>
        <div className="wf-grid two">
          <Field label="Kind">
            <select value={m.kind} onChange={(e) => set('kind', e.target.value as MilestoneKind)}>
              {MILESTONE_KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </Field>
          <DateInput
            label="Due date"
            value={m.dueDate || null}
            onChange={(v) => set('dueDate', v ?? '')}
            required
          />
          <PersonPicker
            label="Owner"
            noneLabel="No owner"
            value={m.owner}
            onChange={(v) => set('owner', v)}
          />
        </div>
        {error && (
          <p className="wf-error" role="alert">
            {error}
          </p>
        )}
        <div className="wf-form-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={busy}>
            {milestone ? 'Save deadline' : 'Add deadline'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
