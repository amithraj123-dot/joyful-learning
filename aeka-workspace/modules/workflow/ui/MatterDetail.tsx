'use client';
// Mandate detail: header with status and team, and tabs for tasks, time, deal, team and reviews,
// meetings, billing, deadlines and activity.
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Flame, Lock, Pencil, Trash2 } from 'lucide-react';
import { MATTER_STATUSES, MATTER_STATUS_LABELS, type Matter, type MatterStatus } from '../shared/types';
import { StatusPill, TabPanel, Tabs } from './components/Bits';
import { ConfirmButton } from './components/ConfirmButton';
import { PersonList } from './components/People';
import { ActivityList } from './ActivityPage';
import { BillingEditor } from './BillingPage';
import { MilestoneList } from './DeadlinesPage';
import { DealSummary } from './DealsPage';
import type { Nav } from './lib';
import { MatterForm } from './MatterForms';
import { MatterMeetingsTab } from './MatterMeetingsTab';
import { MatterTasksTab } from './MatterTasksTab';
import { MatterTeamTab } from './MatterTeamTab';
import { matterInput, useWF } from './store';
import { MatterTimeTab } from './TimePage';

type Tab = 'tasks' | 'time' | 'deal' | 'team' | 'meetings' | 'billing' | 'deadlines' | 'activity';

export function MatterDetail({
  matter,
  navigate,
  onBack,
}: {
  matter: Matter;
  navigate: Nav;
  onBack: () => void;
}) {
  const {
    clientById,
    caps,
    run,
    dispatch,
    notify,
    tasks,
    milestones,
    setFocusDeal,
    matterTab,
    setMatterTab,
  } = useWF();
  // A tab asked for by another module (for example Meetings, from a Scribe note) is shown once.
  const [tab, setTab] = useState<Tab>(() => (matterTab as Tab | null) ?? 'tasks');
  useEffect(() => setMatterTab(null), [setMatterTab]);
  const [editing, setEditing] = useState(false);
  const client = clientById.get(matter.clientId);
  const openTasks = tasks.filter((t) => t.matterId === matter.id && t.status !== 'Completed').length;
  const openDeadlines = milestones.filter((m) => m.matterId === matter.id && !m.done).length;
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'tasks', label: 'Tasks', count: openTasks },
    { id: 'time', label: 'Timesheet' },
    ...(matter.isDeal ? [{ id: 'deal' as const, label: 'Deal tracker' }] : []),
    { id: 'team', label: 'Team and reviews' },
    { id: 'meetings', label: 'Meetings' },
    ...(caps.viewBilling ? [{ id: 'billing' as const, label: 'Billing' }] : []),
    { id: 'deadlines', label: 'Deadlines', count: openDeadlines },
    { id: 'activity', label: 'Activity' },
  ];
  const current = tabs.some((t) => t.id === tab) ? tab : 'tasks';

  const quickUpdate = async (patch: Partial<Matter>) => {
    const saved = await run('matter.update', {
      id: matter.id,
      matter: { ...matterInput(matter), ...patch },
      baseRevision: matter.revision,
    });
    if (saved) dispatch({ type: 'matter', matter: saved });
    return saved;
  };

  return (
    <div className="wf-stack">
      <div className="wf-toolbar">
        <button type="button" className="button ghost" onClick={onBack}>
          <ArrowLeft size={15} /> All clients and mandates
        </button>
      </div>
      <section className="card wf-detail-head" aria-labelledby="wf-matter-h">
        <div className="wf-detail-top">
          <div>
            <p className="wf-eyebrow">{client?.name}</p>
            <h2 id="wf-matter-h">
              {matter.priority && <Flame size={18} className="wf-red" aria-label="High priority" />}
              {matter.title}
            </h2>
            <div className="wf-row wf-wrap">
              <StatusPill value={matter.status} label={MATTER_STATUS_LABELS[matter.status]} />
              <span className="wf-type">{matter.type || 'Other'}</span>
              <span className="wf-caption">Stage: {matter.stage}</span>
              {matter.restricted && (
                <span className="wf-pill grey">
                  <Lock size={12} aria-hidden="true" /> Restricted
                </span>
              )}
              {matter.isDeal && <span className="wf-pill tint">Deal</span>}
            </div>
          </div>
          {caps.manageMatters && (
            <div className="wf-row wf-wrap wf-detail-actions">
              <label className="wf-inline-field">
                <span>Status</span>
                <select
                  value={matter.status}
                  onChange={(e) => void quickUpdate({ status: e.target.value as MatterStatus })}
                >
                  {MATTER_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {MATTER_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className={'button secondary' + (matter.priority ? ' pressed' : '')}
                aria-pressed={matter.priority}
                onClick={() => void quickUpdate({ priority: !matter.priority })}
              >
                <Flame size={15} /> Priority
              </button>
              <button type="button" className="button secondary" onClick={() => setEditing(true)}>
                <Pencil size={15} /> Edit
              </button>
              <ConfirmButton
                question="Move this mandate to the trash?"
                confirmLabel="Move to trash"
                onConfirm={async () => {
                  if (await run('matter.delete', { id: matter.id, baseRevision: matter.revision })) {
                    dispatch({ type: 'matterGone', id: matter.id });
                    notify('Mandate moved to the trash');
                    onBack();
                  }
                }}
              >
                <Trash2 size={15} /> Delete
              </ConfirmButton>
            </div>
          )}
        </div>
        <div className="wf-detail-team">
          <span className="wf-caption">Team</span>
          <PersonList people={matter.team} max={8} />
        </div>
        {matter.note && <p className="wf-note-text">{matter.note}</p>}
      </section>

      <Tabs label="Mandate sections" tabs={tabs} value={current} onChange={setTab} />
      <TabPanel id={current}>
        {current === 'tasks' && <MatterTasksTab matter={matter} />}
        {current === 'time' && <MatterTimeTab matter={matter} />}
        {current === 'deal' && (
          <div className="card wf-section">
            <DealSummary matterId={matter.id} />
            <button
              type="button"
              className="text-link"
              onClick={() => {
                setFocusDeal(matter.id);
                navigate('workflow/deals');
              }}
            >
              Open in the deal tracker <ArrowUpRight size={14} />
            </button>
          </div>
        )}
        {current === 'team' && <MatterTeamTab matter={matter} onUpdate={quickUpdate} />}
        {current === 'meetings' && <MatterMeetingsTab matter={matter} navigate={navigate} />}
        {current === 'billing' && <BillingEditor matter={matter} />}
        {current === 'deadlines' && (
          <div className="card wf-section">
            <MilestoneList matterId={matter.id} />
          </div>
        )}
        {current === 'activity' && (
          <div className="card wf-section">
            <ActivityList target={matter.id} />
          </div>
        )}
      </TabPanel>
      {editing && <MatterForm matter={matter} onClose={() => setEditing(false)} />}
    </div>
  );
}
