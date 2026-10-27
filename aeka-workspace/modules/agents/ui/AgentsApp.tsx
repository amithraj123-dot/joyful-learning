'use client';
// Agents module view: home (command, approvals, agents, runs), memory and learning, firm templates.
// The agent and run drawers live here so every page can open them; a change made in a drawer bumps
// refreshKey and the page reloads quietly.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModuleViewProps } from '../../../core/client/module';
import { handOverLink } from '../../../core/client/handover';
import { findPage } from '../../../core/client/registry';
import type { Run } from '../shared/types';
import { AgentDrawer } from './AgentDrawer';
import { HomePage } from './HomePage';
import { LearningPage } from './LearningPage';
import { RunDrawer } from './RunDrawer';
import { TemplatesPage } from './TemplatesPage';
import '../../workflow/ui/workflow.css';
import './agents.css';

export default function AgentsApp({ page, navigate, notify }: ModuleViewProps) {
  // The shell passes new functions on each render; keep stable wrappers.
  const nav = useRef(navigate);
  const note = useRef(notify);
  useEffect(() => {
    nav.current = navigate;
    note.current = notify;
  });
  const stableNotify = useCallback((m: string) => note.current(m), []);

  const [agentId, setAgentId] = useState<string | null>(null);
  const [run, setRun] = useState<{ id: string; initial?: Run } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const changed = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Leaving the page closes the drawers.
  const stableNavigate = useCallback((p: string) => {
    setAgentId(null);
    setRun(null);
    nav.current(p);
  }, []);
  // Links from runs and approvals: "<page id>" or "<page id>#<record id>" (the record is handed over).
  const openLink = useCallback(
    (link: string) => {
      const target = handOverLink(link);
      if (findPage(target)) stableNavigate(target);
      else note.current('That page is not available here.');
    },
    [stableNavigate],
  );
  const openAgent = useCallback((id: string) => setAgentId(id), []);
  const openRun = useCallback((id: string, initial?: Run) => setRun({ id, initial }), []);

  return (
    <div className="wf agents">
      {page === 'agents/learning' ? (
        <LearningPage navigate={stableNavigate} notify={stableNotify} refreshKey={refreshKey} />
      ) : page === 'agents/templates' ? (
        <TemplatesPage notify={stableNotify} openAgent={openAgent} refreshKey={refreshKey} />
      ) : (
        <HomePage
          notify={stableNotify}
          openAgent={openAgent}
          openRun={openRun}
          openLink={openLink}
          refreshKey={refreshKey}
        />
      )}

      {agentId && (
        <AgentDrawer
          key={agentId}
          agentId={agentId}
          onClose={() => setAgentId(null)}
          onChanged={changed}
          onOpenRun={openRun}
          navigate={stableNavigate}
          notify={stableNotify}
        />
      )}
      {/* Rendered after the agent drawer, so a run opened from an agent sits on top of it. */}
      {run && (
        <RunDrawer
          key={run.id}
          runId={run.id}
          initial={run.initial}
          onClose={() => setRun(null)}
          onChanged={changed}
          openLink={openLink}
          notify={stableNotify}
        />
      )}
    </div>
  );
}
