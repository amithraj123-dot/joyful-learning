'use client';
// Agents home: a plain-text command (run once now, or saved as an agent after confirming how Aeka
// read it), what waits for approval, my agents and recent runs. Refreshes every minute while visible.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Bot, Play, Sparkles, TriangleAlert } from 'lucide-react';
import { Empty, StatusPill } from '../../workflow/ui/components/Bits';
import { agents } from '../shared/client';
import type { Agent, Approval, Plan, Run, Trigger } from '../shared/types';
import { ApprovalCard } from './ApprovalCard';
import { RunRow } from './AgentDrawer';
import { atLabel, errorMessage, MAX, plural, triggerLabel, triggerProblem } from './lib';
import { TriggerEditor } from './TriggerEditor';

const REFRESH_MS = 60 * 1000;
const EXAMPLES = [
  'Every weekday at 6 pm, list my overdue to-dos and Workflow tasks and notify me',
  'When an urgent email arrives from Kestrel, make a to-do and draft a holding reply',
  'Every Monday at 9 am, summarise the deadlines falling due this week',
];

export interface Openers {
  openAgent: (id: string) => void;
  openRun: (id: string, initial?: Run) => void;
  openLink: (link: string) => void;
}

export function HomePage({
  notify,
  openAgent,
  openRun,
  openLink,
  refreshKey,
}: Openers & { notify: (m: string) => void; refreshKey: number }) {
  const id = useId();
  const [command, setCommand] = useState('');
  const [busy, setBusy] = useState<'' | 'run' | 'plan' | 'save'>('');
  const [cmdError, setCmdError] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [list, setList] = useState<Agent[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const seq = useRef(0);

  const load = useCallback(async (quiet = false) => {
    const mine = ++seq.current;
    if (!quiet) setPhase('loading');
    try {
      const [a, p, r] = await Promise.all([
        agents('agents.list', {}),
        agents('approvals.list', { status: 'pending' }),
        agents('runs.list', { limit: 15 }),
      ]);
      if (mine !== seq.current) return;
      setList(a.agents);
      setApprovals(p);
      setRuns(r);
      setPhase('ready');
      setError('');
    } catch (e) {
      if (mine !== seq.current) return;
      setError(errorMessage(e));
      setPhase((x) => (x === 'ready' ? x : 'error'));
    }
  }, []);

  // The first load runs after the effect (never setting state within it); later ones follow changes
  // made in the drawers.
  const first = useRef(true);
  useEffect(() => {
    const quiet = !first.current;
    first.current = false;
    void Promise.resolve().then(() => load(quiet));
  }, [load, refreshKey]);

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const runCommand = async () => {
    setBusy('run');
    setCmdError('');
    try {
      const run = await agents('command.run', { command: command.trim() });
      openRun(run.id, run);
      void load(true);
    } catch (e) {
      setCmdError(errorMessage(e));
    } finally {
      setBusy('');
    }
  };

  const makePlan = async () => {
    setBusy('plan');
    setCmdError('');
    try {
      setPlan(await agents('command.plan', { command: command.trim() }));
    } catch (e) {
      setCmdError(errorMessage(e));
    } finally {
      setBusy('');
    }
  };

  const savePlan = async () => {
    if (!plan) return;
    setBusy('save');
    setCmdError('');
    try {
      const saved = await agents('agent.save', {
        agent: {
          name: plan.name.trim(),
          instruction: plan.instruction.trim(),
          trigger: plan.trigger,
          status: 'active',
        },
      });
      notify(`Saved ${saved.name}. It is switched on.`);
      setPlan(null);
      setCommand('');
      void load(true);
    } catch (e) {
      setCmdError(errorMessage(e));
    } finally {
      setBusy('');
    }
  };

  const text = command.trim();
  const planProblem = plan
    ? !plan.name.trim()
      ? 'Give the agent a name.'
      : !plan.instruction.trim()
        ? 'Say what the agent should do.'
        : triggerProblem(plan.trigger)
    : '';

  return (
    <div className="ag-page">
      <section className="ag-card ag-command" aria-labelledby={id + '-cmd'}>
        <label htmlFor={id + '-text'} id={id + '-cmd'} className="ag-command-label">
          Tell Aeka what to do
        </label>
        <textarea
          id={id + '-text'}
          rows={3}
          value={command}
          maxLength={MAX.command}
          disabled={!!plan || !!busy}
          placeholder={'For example:\n' + EXAMPLES.join('\n')}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text && !busy && !plan) void runCommand();
          }}
        />
        <p className="ag-note">
          Aeka prepares the work on its own. Anything that leaves the workspace, or changes shared records,
          waits for your approval here.
        </p>
        {cmdError && (
          <p className="ag-error" role="alert">
            <TriangleAlert size={16} aria-hidden="true" /> {cmdError}
          </p>
        )}
        {!plan && (
          <div className="ag-actions">
            <button
              type="button"
              className="button primary"
              disabled={!text || !!busy}
              onClick={() => void runCommand()}
            >
              <Play size={16} aria-hidden="true" /> {busy === 'run' ? 'Running…' : 'Run now'}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={!text || !!busy}
              onClick={() => void makePlan()}
            >
              <Sparkles size={16} aria-hidden="true" /> {busy === 'plan' ? 'Reading…' : 'Make it an agent'}
            </button>
          </div>
        )}
        {busy === 'run' && <p className="ag-note">Running. This can take up to a minute.</p>}

        {plan && (
          <div className="ag-plan" aria-label="The new agent">
            <p className="ag-reads">
              <strong>How Aeka read it:</strong> {plan.explanation}
            </p>
            <div className="wf-field">
              <label htmlFor={id + '-name'}>Name</label>
              <input
                id={id + '-name'}
                type="text"
                value={plan.name}
                maxLength={MAX.name}
                onChange={(e) => setPlan({ ...plan, name: e.target.value })}
              />
            </div>
            <div className="wf-field">
              <label htmlFor={id + '-ins'}>What it does</label>
              <textarea
                id={id + '-ins'}
                rows={4}
                value={plan.instruction}
                maxLength={MAX.instruction}
                onChange={(e) => setPlan({ ...plan, instruction: e.target.value })}
              />
            </div>
            <TriggerEditor
              value={plan.trigger}
              onChange={(trigger: Trigger) => setPlan({ ...plan, trigger })}
            />
            {planProblem && <p className="ag-problem">{planProblem}</p>}
            <div className="ag-actions">
              <button
                type="button"
                className="button primary"
                disabled={!!busy || !!planProblem}
                onClick={() => void savePlan()}
              >
                {busy === 'save' ? 'Saving…' : 'Save and switch on'}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={!!busy}
                onClick={() => setPlan(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {phase === 'loading' && <p className="ag-note">Loading agents…</p>}
      {phase === 'error' && (
        <div className="ag-card ag-banner" role="alert">
          <TriangleAlert size={22} aria-hidden="true" />
          <div>
            <strong>Agents could not be loaded</strong>
            <p>{error}</p>
          </div>
          <button type="button" className="button secondary" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}

      {phase === 'ready' && approvals.length > 0 && (
        <section className="ag-section" aria-labelledby={id + '-appr'}>
          <h2 id={id + '-appr'}>
            Waiting for your approval <span className="ag-count">{approvals.length}</span>
          </h2>
          <div className="ag-grid">
            {approvals.map((a) => (
              <ApprovalCard
                key={a.id}
                approval={a}
                openLink={openLink}
                notify={notify}
                onDecided={(d) => {
                  setApprovals((list) => list.filter((x) => x.id !== d.id));
                  void load(true);
                }}
              />
            ))}
          </div>
        </section>
      )}

      {phase === 'ready' && (
        <section className="ag-section" aria-labelledby={id + '-agents'}>
          <h2 id={id + '-agents'}>Your agents</h2>
          {list.length === 0 ? (
            <Empty icon={Bot} title="No agents yet">
              Describe what you want done above, then choose Make it an agent. You can also copy one from Firm
              Templates.
            </Empty>
          ) : (
            <ul className="ag-list ag-grid" aria-label="Your agents">
              {list.map((a) => (
                <li key={a.id}>
                  <AgentRow agent={a} onOpen={() => openAgent(a.id)} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {phase === 'ready' && (
        <section className="ag-section" aria-labelledby={id + '-runs'}>
          <h2 id={id + '-runs'}>Recent runs</h2>
          {runs.length === 0 ? (
            <p className="ag-note">Nothing has run yet.</p>
          ) : (
            <ul className="ag-list" aria-label="Recent runs">
              {runs.map((r) => (
                <li key={r.id}>
                  <RunRow run={r} onOpen={() => openRun(r.id, r)} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function AgentRow({ agent: a, onOpen }: { agent: Agent; onOpen: () => void }) {
  const s = a.stats;
  const on = a.status === 'active';
  const when = [
    on && a.nextRunAt ? `Next ${atLabel(a.nextRunAt)}` : '',
    a.lastRunAt ? `Last ${atLabel(a.lastRunAt)}` : 'Not run yet',
  ].filter(Boolean);
  const asked = s.approved + s.rejected;
  const stats = [
    plural(s.runs, 'run'),
    s.good || s.bad ? `${s.good} good, ${s.bad} poor` : '',
    asked ? `${s.approved} of ${plural(asked, 'request')} approved` : '',
    a.monthlyLimit
      ? `${a.usedThisMonth} of ${a.monthlyLimit} AI calls this month`
      : `${a.usedThisMonth} AI calls this month`,
  ].filter(Boolean);
  return (
    <button type="button" className={'ag-row' + (on ? '' : ' paused')} onClick={onOpen}>
      <span className="ag-row-top">
        <strong className="ag-title">{a.name}</strong>
        <StatusPill value={a.status} label={on ? 'On' : 'Paused'} tone={on ? 'green' : 'grey'} />
      </span>
      <span className="ag-trigger-line">{triggerLabel(a.trigger)}</span>
      <span className="ag-meta">{when.join('; ')}</span>
      <span className="ag-meta">{stats.join(', ')}</span>
    </button>
  );
}
