'use client';
// One agent: what it does and when, switched on or paused, what it keeps between runs, the lessons
// it follows, its last runs, publishing it for the firm, and deleting it.
import { useCallback, useEffect, useId, useState } from 'react';
import { Eraser, Play, Share2, Trash2, TriangleAlert } from 'lucide-react';
import { ConfirmButton } from '../../workflow/ui/components/ConfirmButton';
import { Dirty, StatusPill, Toggle } from '../../workflow/ui/components/Bits';
import { Modal } from '../../workflow/ui/components/Modal';
import { agents } from '../shared/client';
import type { AgentInput } from '../shared/contract';
import type { Agent, Lesson, Run } from '../shared/types';
import {
  atLabel,
  errorMessage,
  firstLine,
  isConflict,
  MAX,
  plural,
  RUN_STATUS,
  RUN_TRIGGER_LABELS,
  sameTrigger,
  SOURCE_LABELS,
  triggerProblem,
} from './lib';
import { TriggerEditor } from './TriggerEditor';

const asInput = (a: Agent): AgentInput => ({
  name: a.name,
  instruction: a.instruction,
  trigger: a.trigger,
  status: a.status,
  monthlyLimit: a.monthlyLimit,
});

export function AgentDrawer({
  agentId,
  onClose,
  onChanged,
  onOpenRun,
  navigate,
  notify,
}: {
  agentId: string;
  onClose: () => void;
  onChanged: () => void;
  onOpenRun: (id: string, initial?: Run) => void;
  navigate: (p: string) => void;
  notify: (m: string) => void;
}) {
  const id = useId();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [form, setForm] = useState<AgentInput | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [description, setDescription] = useState('');
  // Remounts the trigger editor when the saved trigger is reloaded, so it shows the server's version.
  const [editorKey, setEditorKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await agents('agent.get', { id: agentId });
      setAgent(r.agent);
      setForm(asInput(r.agent));
      setRuns(r.runs);
      setLessons(r.lessons);
      setEditorKey((k) => k + 1);
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [agentId]);

  // The first load runs after the effect (never setting state within it).
  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  // Runs an action with a busy label; a conflict reloads the agent and says so.
  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError('');
    try {
      await fn();
      return true;
    } catch (e) {
      if (isConflict(e)) {
        await load();
        setError(
          'This agent was changed elsewhere. The latest version has been loaded; make your changes again.',
        );
      } else setError(errorMessage(e));
      return false;
    } finally {
      setBusy('');
    }
  };

  if (!agent || !form)
    return (
      <Modal title="Agent" variant="drawer" onClose={onClose}>
        {error ? (
          <p className="ag-error" role="alert">
            {error}
          </p>
        ) : (
          <p className="ag-note">Loading…</p>
        )}
      </Modal>
    );

  const dirty =
    form.name !== agent.name ||
    form.instruction !== agent.instruction ||
    form.status !== agent.status ||
    form.monthlyLimit !== agent.monthlyLimit ||
    !sameTrigger(form.trigger, agent.trigger);
  const limit = form.monthlyLimit ?? 300;
  const problem = !form.name.trim()
    ? 'Give the agent a name.'
    : !Number.isInteger(limit) || limit < 0 || limit > 5000
      ? 'Set a monthly limit from 0 (no limit) to 5,000 AI calls.'
      : !form.instruction.trim()
        ? 'Say what the agent should do.'
        : triggerProblem(form.trigger);

  const save = () =>
    act('save', async () => {
      const saved = await agents('agent.save', {
        id: agent.id,
        agent: { ...form, name: form.name.trim(), instruction: form.instruction.trim() },
        baseRevision: agent.revision,
      });
      setAgent(saved);
      setForm(asInput(saved));
      notify(`Saved ${saved.name}.`);
      onChanged();
    });

  const runNow = () =>
    act('run', async () => {
      const run = await agents('agent.run', { id: agent.id });
      setRuns((list) => [run, ...list.filter((r) => r.id !== run.id)]);
      onChanged();
      onOpenRun(run.id, run);
    });

  const publish = () =>
    act('publish', async () => {
      const t = await agents('template.publish', { agentId: agent.id, description: description.trim() });
      setPublishing(false);
      setDescription('');
      notify(`Published ${t.name} as a firm template.`);
    });

  const s = agent.stats;
  return (
    <Modal
      title={agent.name}
      subtitle={
        <span className="ag-sub">
          <StatusPill
            value={agent.status}
            label={agent.status === 'active' ? 'Switched on' : 'Paused'}
            tone={agent.status === 'active' ? 'green' : 'grey'}
          />{' '}
          {plural(s.runs, 'run')}
          {agent.nextRunAt ? `, next ${atLabel(agent.nextRunAt)}` : ''}
        </span>
      }
      variant="drawer"
      onClose={onClose}
      footer={
        <div className="ag-foot">
          <Dirty dirty={dirty} />
          <div className="ag-actions">
            <button
              type="button"
              className="button secondary"
              disabled={!!busy || dirty}
              title={dirty ? 'Save your changes first' : undefined}
              onClick={() => void runNow()}
            >
              <Play size={16} aria-hidden="true" /> {busy === 'run' ? 'Running…' : 'Run now'}
            </button>
            <button
              type="button"
              className="button primary"
              disabled={!!busy || !dirty || !!problem}
              onClick={() => void save()}
            >
              {busy === 'save' ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      }
    >
      <div className="ag-d">
        {error && (
          <p className="ag-error" role="alert">
            <TriangleAlert size={16} aria-hidden="true" /> {error}
          </p>
        )}
        {busy === 'run' && <p className="ag-note">Running. This can take up to a minute.</p>}

        <Toggle
          pressed={form.status === 'active'}
          onChange={(on) => setForm({ ...form, status: on ? 'active' : 'paused' })}
        >
          {form.status === 'active' ? 'Switched on' : 'Paused: it runs only when you tap Run now'}
        </Toggle>
        <div className="wf-field">
          <label htmlFor={id + '-name'}>Name</label>
          <input
            id={id + '-name'}
            type="text"
            value={form.name}
            maxLength={MAX.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div className="wf-field">
          <label htmlFor={id + '-ins'}>What it does</label>
          <textarea
            id={id + '-ins'}
            rows={5}
            value={form.instruction}
            maxLength={MAX.instruction}
            onChange={(e) => setForm({ ...form, instruction: e.target.value })}
          />
          <small>
            It prepares work freely, including email and chat reply drafts. Sending an email, or creating or
            changing a Workflow task, waits for your approval.
          </small>
        </div>
        <TriggerEditor
          key={editorKey}
          value={form.trigger}
          onChange={(trigger) => setForm({ ...form, trigger })}
        />
        <div className="wf-field">
          <label htmlFor={id + '-limit'}>AI calls a month (0 for no limit)</label>
          <input
            id={id + '-limit'}
            type="number"
            inputMode="numeric"
            min={0}
            max={5000}
            step={10}
            value={Number.isFinite(limit) ? limit : ''}
            onChange={(e) =>
              setForm({
                ...form,
                monthlyLimit: e.target.value === '' ? 0 : Math.round(Number(e.target.value)),
              })
            }
          />
          <small>
            Used this month: {agent.usedThisMonth}
            {agent.monthlyLimit ? ` of ${agent.monthlyLimit}` : ''}. A run is about 2 to 6 calls. When the
            limit is reached it stops until the 1st, and tells you.
          </small>
        </div>
        {problem && dirty && <p className="ag-problem">{problem}</p>}
        {dirty && <p className="ag-note">Save your changes before you run it.</p>}

        <p className="ag-meta">
          {s.good} good, {s.bad} poor ratings; {s.approved} approved, {s.rejected} rejected
          {agent.lastRunAt ? `; last run ${atLabel(agent.lastRunAt)}` : ''}
        </p>

        <section className="ag-sec" aria-labelledby={id + '-notes'}>
          <h3 id={id + '-notes'}>What it remembers between runs</h3>
          {agent.notes.trim() ? (
            <>
              <p className="ag-pre ag-quote">{agent.notes}</p>
              <ConfirmButton
                className="button secondary small"
                question="Clear what it remembers?"
                confirmLabel="Clear"
                disabled={!!busy}
                onConfirm={() =>
                  act('notes', async () => {
                    const a = await agents('agent.clearNotes', { id: agent.id });
                    setAgent(a);
                    notify('Its notes are cleared.');
                  })
                }
              >
                <Eraser size={15} aria-hidden="true" /> Clear
              </ConfirmButton>
            </>
          ) : (
            <p className="ag-note">Nothing yet. The agent writes notes here for its next run.</p>
          )}
        </section>

        <section className="ag-sec" aria-labelledby={id + '-lessons'}>
          <h3 id={id + '-lessons'}>Lessons it follows</h3>
          {lessons.length ? (
            <ul className="ag-lessons">
              {lessons.map((l) => (
                <li key={l.id}>
                  <span className="ag-lesson-text">{l.text}</span>
                  <span className="ag-meta">
                    {l.agentId ? '' : 'For every agent, '}
                    {SOURCE_LABELS[l.source]}, used in {plural(l.uses, 'run')}
                  </span>
                  <ConfirmButton
                    className="button ghost small"
                    question="Remove this lesson?"
                    confirmLabel="Remove"
                    ariaLabel={'Remove lesson: ' + l.text}
                    onConfirm={() =>
                      act('lesson', async () => {
                        await agents('lesson.delete', { id: l.id });
                        setLessons((list) => list.filter((x) => x.id !== l.id));
                      })
                    }
                  >
                    <Trash2 size={15} aria-hidden="true" /> Remove
                  </ConfirmButton>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ag-note">No lessons yet. Rate its runs and it will learn.</p>
          )}
          <button type="button" className="button ghost small" onClick={() => navigate('agents/learning')}>
            All lessons
          </button>
        </section>

        <section className="ag-sec" aria-labelledby={id + '-runs'}>
          <h3 id={id + '-runs'}>Last runs</h3>
          {runs.length ? (
            <ul className="ag-list">
              {runs.map((r) => (
                <li key={r.id}>
                  <RunRow run={r} showAgent={false} onOpen={() => onOpenRun(r.id, r)} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="ag-note">It has not run yet.</p>
          )}
        </section>

        <section className="ag-sec" aria-labelledby={id + '-more'}>
          <h3 id={id + '-more'}>More</h3>
          {publishing ? (
            <div className="ag-publish">
              <div className="wf-field">
                <label htmlFor={id + '-desc'}>Describe it for colleagues</label>
                <textarea
                  id={id + '-desc'}
                  rows={3}
                  value={description}
                  maxLength={MAX.description}
                  autoFocus
                  placeholder="For example: a daily list of overdue items for partners"
                  onChange={(e) => setDescription(e.target.value)}
                />
                <small>Colleagues get a paused copy. Its notes and lessons are not shared.</small>
              </div>
              <div className="ag-actions">
                <button
                  type="button"
                  className="button primary"
                  disabled={!!busy || !description.trim()}
                  onClick={() => void publish()}
                >
                  {busy === 'publish' ? 'Publishing…' : 'Publish'}
                </button>
                <button type="button" className="button secondary" onClick={() => setPublishing(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="ag-actions">
              <button
                type="button"
                className="button secondary"
                disabled={!!busy}
                onClick={() => setPublishing(true)}
              >
                <Share2 size={16} aria-hidden="true" /> Publish as firm template
              </button>
              <ConfirmButton
                question="Delete this agent?"
                disabled={!!busy}
                onConfirm={() =>
                  act('delete', async () => {
                    await agents('agent.delete', { id: agent.id });
                    notify(`Deleted ${agent.name}.`);
                    onChanged();
                    onClose();
                  })
                }
              >
                <Trash2 size={16} aria-hidden="true" /> Delete
              </ConfirmButton>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}

// A run in a list: agent (or "Command"), how it started, when, status and the report's first line.
export function RunRow({
  run: r,
  onOpen,
  showAgent = true,
}: {
  run: Run;
  onOpen: () => void;
  showAgent?: boolean;
}) {
  const status = RUN_STATUS[r.status];
  return (
    <button type="button" className="ag-row" onClick={onOpen}>
      <span className="ag-row-top">
        {showAgent && <strong className="ag-title">{r.agentId ? r.agentName : 'Command'}</strong>}
        <StatusPill value={r.status} label={status.label} tone={status.tone} />
        {r.rating !== 0 && <span className="ag-tag">{r.rating === 1 ? 'Good' : 'Poor'}</span>}
        <span className="ag-when">{atLabel(r.startedAt)}</span>
      </span>
      <span className="ag-meta">{RUN_TRIGGER_LABELS[r.trigger]}</span>
      <span className="ag-text">
        {firstLine(r.error && !r.summary ? r.error : r.summary) || firstLine(r.command)}
      </span>
    </button>
  );
}
