'use client';
// Task drawer: every field of a task with an explicit Save (Ctrl+Enter), a dirty indicator and the
// maker-checker rule shown beside the preparer and reviewer.
import { useState } from 'react';
import { ArrowUpRight, Plus, Star, Trash2, X } from 'lucide-react';
import type { TaskInput } from '../shared/contract';
import { TASK_STATUSES, type Task, type TaskStatus } from '../shared/types';
import { ConfirmButton } from './components/ConfirmButton';
import { Dirty, StatusPill, Toggle } from './components/Bits';
import { DateInput, Field } from './components/Inputs';
import { Modal } from './components/Modal';
import { PersonBadge, PersonPicker } from './components/People';
import { formatDate, formatStamp, uid } from './lib';
import { taskInput, useWF } from './store';
import { MAKER_CHECKER_RULE, signOffProblem, useTaskActions } from './taskActions';

export function TaskDrawer({
  taskId,
  onClose,
  onOpenMatter,
}: {
  taskId: string;
  onClose: () => void;
  onOpenMatter?: (matterId: string) => void;
}) {
  const { tasks } = useWF();
  const task = tasks.find((t) => t.id === taskId);
  if (!task)
    return (
      <Modal title="Task not available" onClose={onClose} variant="drawer">
        <p>This task has been deleted or moved out of your view.</p>
      </Modal>
    );
  // Remount when a different task is opened so the draft starts from that task.
  return <DrawerBody key={task.id} task={task} onClose={onClose} onOpenMatter={onOpenMatter} />;
}

function DrawerBody({
  task,
  onClose,
  onOpenMatter,
}: {
  task: Task;
  onClose: () => void;
  onOpenMatter?: (matterId: string) => void;
}) {
  const { matters, matterById, clientById } = useWF();
  const actions = useTaskActions();
  const [base, setBase] = useState<Task>(task);
  const [draft, setDraft] = useState<TaskInput>(() => taskInput(task));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [newStep, setNewStep] = useState('');
  const [closing, setClosing] = useState(false);

  const dirty = JSON.stringify(draft) !== JSON.stringify(taskInput(base));
  const changedElsewhere = task.revision !== base.revision;
  const editable = actions.canEdit(base);
  const matter = matterById.get(draft.matterId);
  const siblings = matters.filter((m) => m.clientId === matter?.clientId);
  const set = <K extends keyof TaskInput>(k: K, v: TaskInput[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setError('');
  };
  const problem = signOffProblem(draft, base);

  const save = async () => {
    if (!dirty || saving) return;
    if (!draft.title.trim()) return setError('Enter a title for the task.');
    if (problem) return setError(problem);
    setSaving(true);
    const saved = await actions.update(base, { ...draft, title: draft.title.trim() }, { onError: setError });
    setSaving(false);
    if (saved) {
      setBase(saved);
      setDraft(taskInput(saved));
    }
  };
  const loadLatest = () => {
    setBase(task);
    setDraft(taskInput(task));
    setError('');
  };
  const requestClose = () => (dirty ? setClosing(true) : onClose());
  const steps = draft.steps;
  const setSteps = (s: TaskInput['steps']) => set('steps', s);

  return (
    <Modal
      variant="drawer"
      title="Task"
      subtitle={matter ? `${clientById.get(matter.clientId)?.name ?? ''}: ${matter.title}` : undefined}
      onClose={requestClose}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          void save();
        }
      }}
      footer={
        closing ? (
          <div className="wf-row wf-between">
            <span>Discard the unsaved changes to this task?</span>
            <span className="wf-row">
              <button type="button" className="button danger" onClick={onClose}>
                Discard
              </button>
              <button type="button" className="button secondary" onClick={() => setClosing(false)}>
                Keep editing
              </button>
            </span>
          </div>
        ) : (
          <div className="wf-row wf-between">
            <Dirty dirty={dirty} />
            <span className="wf-row">
              {actions.canDelete(base) && (
                <ConfirmButton
                  question="Delete this task?"
                  onConfirm={async () => {
                    if (await actions.remove(base)) onClose();
                  }}
                  ariaLabel="Delete task"
                >
                  <Trash2 size={15} /> Delete
                </ConfirmButton>
              )}
              <button
                type="button"
                className="button primary"
                disabled={!dirty || saving || !editable}
                onClick={() => void save()}
                title="Save (Ctrl+Enter)"
              >
                {saving ? 'Saving' : 'Save'}
              </button>
            </span>
          </div>
        )
      }
    >
      {changedElsewhere && (
        <div className="notice warning" role="status">
          <span>This task was changed by someone else after you opened it.</span>
          <button type="button" onClick={loadLatest}>
            Load the latest version
          </button>
        </div>
      )}
      {!editable && (
        <p className="wf-note">
          Only the mandate team, the assignee, the creator and Assistant Managers and above can edit this
          task.
        </p>
      )}
      <fieldset className="wf-plain" disabled={!editable}>
        <Field label="Title">
          <textarea
            rows={2}
            value={draft.title}
            data-autofocus
            onChange={(e) => set('title', e.target.value)}
          />
        </Field>
        <div className="wf-grid two">
          <Field label="Status">
            <select value={draft.status} onChange={(e) => set('status', e.target.value as TaskStatus)}>
              {TASK_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <DateInput label="Due date" value={draft.dueDate} onChange={(v) => set('dueDate', v)} />
          <PersonPicker label="Currently with" value={draft.assignee} onChange={(v) => set('assignee', v)} />
          <div className="wf-field">
            <span>Priority</span>
            <Toggle pressed={draft.priority} onChange={(v) => set('priority', v)}>
              <Star size={15} aria-hidden="true" /> {draft.priority ? 'Priority' : 'Normal'}
            </Toggle>
          </div>
        </div>

        <section className="wf-signoff" aria-labelledby="wf-signoff-h">
          <h3 id="wf-signoff-h">Preparation and review</h3>
          <p className="wf-caption">{MAKER_CHECKER_RULE}</p>
          <div className="wf-grid two">
            <PersonPicker
              label="Prepared by"
              noneLabel="Not recorded"
              value={draft.preparedBy}
              onChange={(v) => set('preparedBy', v)}
            />
            <PersonPicker
              label="Reviewed by"
              noneLabel="Not recorded"
              value={draft.reviewedBy}
              onChange={(v) => set('reviewedBy', v)}
            />
          </div>
          {base.reviewedAt && (
            <p className="wf-caption">
              Signed off by <PersonBadge person={base.reviewedBy} showName /> on{' '}
              {formatStamp(base.reviewedAt)}
            </p>
          )}
          {problem && <p className="wf-error">{problem}</p>}
        </section>

        <section aria-labelledby="wf-steps-h">
          <h3 id="wf-steps-h" className="wf-h3">
            Steps{' '}
            <span className="wf-caption">
              {steps.filter((s) => s.done).length} of {steps.length} done
            </span>
          </h3>
          <ul className="wf-steps">
            {steps.map((s, i) => (
              <li key={s.id}>
                <input
                  type="checkbox"
                  checked={s.done}
                  aria-label={`Step ${i + 1} done`}
                  onChange={(e) =>
                    setSteps(steps.map((x) => (x.id === s.id ? { ...x, done: e.target.checked } : x)))
                  }
                />
                <input
                  className={'wf-inline-input' + (s.done ? ' done' : '')}
                  value={s.text}
                  aria-label={`Step ${i + 1}`}
                  onChange={(e) =>
                    setSteps(steps.map((x) => (x.id === s.id ? { ...x, text: e.target.value } : x)))
                  }
                />
                <button
                  type="button"
                  className="wf-icon-btn"
                  aria-label={`Remove step ${i + 1}`}
                  onClick={() => setSteps(steps.filter((x) => x.id !== s.id))}
                >
                  <X size={15} />
                </button>
              </li>
            ))}
          </ul>
          <div className="wf-row">
            <input
              className="wf-input grow"
              value={newStep}
              placeholder="Add a step"
              aria-label="New step"
              onChange={(e) => setNewStep(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.ctrlKey && newStep.trim()) {
                  e.preventDefault();
                  setSteps([...steps, { id: uid(), text: newStep.trim(), done: false }]);
                  setNewStep('');
                }
              }}
            />
            <button
              type="button"
              className="button secondary"
              disabled={!newStep.trim()}
              onClick={() => {
                setSteps([...steps, { id: uid(), text: newStep.trim(), done: false }]);
                setNewStep('');
              }}
            >
              <Plus size={15} /> Add step
            </button>
          </div>
        </section>

        <Field label="Notes and reminders">
          <textarea rows={4} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>

        <Field label="Mandate" hint="A task can move to another mandate of the same client.">
          <select value={draft.matterId} onChange={(e) => set('matterId', e.target.value)}>
            {siblings.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
                {m.status === 'closed' ? ' (closed)' : ''}
              </option>
            ))}
          </select>
        </Field>
      </fieldset>
      {error && (
        <p className="wf-error" role="alert">
          {error}
        </p>
      )}
      <div className="wf-meta">
        <span>
          <StatusPill value={base.status} />
        </span>
        <span>
          Created by <PersonBadge person={base.createdBy} showName /> on {formatStamp(base.createdAt)}
        </span>
        {base.dueDate && <span>Due {formatDate(base.dueDate)}</span>}
        {onOpenMatter && (
          <button type="button" className="text-link" onClick={() => onOpenMatter(base.matterId)}>
            Open the mandate <ArrowUpRight size={14} />
          </button>
        )}
      </div>
    </Modal>
  );
}
