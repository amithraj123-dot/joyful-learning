'use client';
// One run: what it was told, its report, each step, what it asked to do, and the member's rating.
// A poor rating or a comment teaches the agent; the lessons drawn are shown at once. Refreshes every
// few seconds while the run is still going.
import { useCallback, useEffect, useId, useState } from 'react';
import { CircleCheck, CircleX, ExternalLink, ThumbsDown, ThumbsUp, TriangleAlert } from 'lucide-react';
import { Modal } from '../../workflow/ui/components/Modal';
import { StatusPill } from '../../workflow/ui/components/Bits';
import { agents } from '../shared/client';
import type { Approval, Lesson, Run } from '../shared/types';
import { ApprovalCard } from './ApprovalCard';
import { atLabel, errorMessage, learnt, MAX, RUN_STATUS, RUN_TRIGGER_LABELS, SOURCE_LABELS } from './lib';

const POLL_MS = 3000;

export function RunDrawer({
  runId,
  initial,
  onClose,
  onChanged,
  openLink,
  notify,
}: {
  runId: string;
  initial?: Run; // shown until the full run (with its approvals) arrives
  onClose: () => void;
  onChanged: () => void;
  openLink: (link: string) => void;
  notify: (m: string) => void;
}) {
  const id = useId();
  const [run, setRun] = useState<Run | null>(initial ?? null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [error, setError] = useState('');
  const [rating, setRating] = useState<1 | -1 | 0>(initial?.rating ?? 0);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [lessons, setLessons] = useState<Lesson[]>([]);

  const load = useCallback(async () => {
    try {
      const r = await agents('run.get', { id: runId });
      setRun(r.run);
      setApprovals(r.approvals);
      setRating((x) => x || r.run.rating);
      setError('');
      return r.run;
    } catch (e) {
      setError(errorMessage(e));
      return null;
    }
  }, [runId]);

  // The first load runs after the effect (never setting state within it).
  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  const running = run?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void load().then((r) => {
        if (r && r.status !== 'running') onChanged();
      });
    }, POLL_MS);
    return () => clearInterval(t);
  }, [running, load, onChanged]);

  const sendFeedback = async () => {
    if (!rating) return;
    setSending(true);
    setError('');
    try {
      const r = await agents('run.feedback', {
        id: runId,
        rating,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
      });
      setRun(r.run);
      setLessons(r.lessons);
      setComment('');
      notify('Thank you. Your feedback is saved.' + learnt(r.lessons));
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  if (!run)
    return (
      <Modal title="Run" variant="drawer" onClose={onClose}>
        {error ? (
          <p className="ag-error" role="alert">
            {error}
          </p>
        ) : (
          <p className="ag-note">Loading…</p>
        )}
      </Modal>
    );

  const status = RUN_STATUS[run.status];
  return (
    <Modal
      title={run.agentId ? run.agentName : 'Command'}
      subtitle={
        <span className="ag-sub">
          <StatusPill value={run.status} label={status.label} tone={status.tone} />{' '}
          {RUN_TRIGGER_LABELS[run.trigger]}, {atLabel(run.startedAt)}
        </span>
      }
      variant="drawer"
      onClose={onClose}
    >
      <div className="ag-d">
        {error && (
          <p className="ag-error" role="alert">
            <TriangleAlert size={16} aria-hidden="true" /> {error}
          </p>
        )}

        <section className="ag-sec" aria-labelledby={id + '-cmd'}>
          <h3 id={id + '-cmd'}>What it was asked</h3>
          <p className="ag-pre ag-quote">{run.command}</p>
        </section>

        <section className="ag-sec" aria-labelledby={id + '-rep'} aria-live="polite">
          <h3 id={id + '-rep'}>Report</h3>
          {running ? (
            <p className="ag-note">Working on it. This page updates by itself.</p>
          ) : run.summary ? (
            <p className="ag-pre">{run.summary}</p>
          ) : (
            <p className="ag-note">No report.</p>
          )}
          {run.error && (
            <p className="ag-error" role="alert">
              <TriangleAlert size={16} aria-hidden="true" /> {run.error}
            </p>
          )}
        </section>

        {run.steps.length > 0 && (
          <section className="ag-sec" aria-labelledby={id + '-steps'}>
            <h3 id={id + '-steps'}>Steps</h3>
            <ol className="ag-steps">
              {run.steps.map((s, i) => (
                <li key={i} className={s.ok ? 'ok' : 'failed'}>
                  {s.ok ? (
                    <CircleCheck size={18} aria-label="Done" />
                  ) : (
                    <CircleX size={18} aria-label="Failed" />
                  )}
                  <span className="ag-step-main">
                    <code>{s.tool}</code>
                    <span>{s.summary}</span>
                  </span>
                  {s.ref && (
                    <button
                      type="button"
                      className="button secondary small"
                      onClick={() => openLink(s.ref!)}
                      aria-label={'Open: ' + s.summary}
                    >
                      <ExternalLink size={15} aria-hidden="true" /> Open
                    </button>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}

        {approvals.length > 0 && (
          <section className="ag-sec" aria-labelledby={id + '-appr'}>
            <h3 id={id + '-appr'}>What it asked to do</h3>
            {approvals.map((a) => (
              <ApprovalCard
                key={a.id}
                approval={a}
                showAgent={false}
                openLink={openLink}
                notify={notify}
                onDecided={(d) => {
                  setApprovals((list) => list.map((x) => (x.id === d.id ? d : x)));
                  onChanged();
                }}
              />
            ))}
          </section>
        )}

        {!running && (
          <section className="ag-sec ag-feedback" aria-labelledby={id + '-fb'}>
            <h3 id={id + '-fb'}>How did it do?</h3>
            {run.rating !== 0 && (
              <p className="ag-note">
                You rated this {run.rating === 1 ? 'good' : 'poor'}
                {run.feedback ? `: "${run.feedback}"` : '.'} You can change it.
              </p>
            )}
            <div className="ag-actions" role="group" aria-label="Rating">
              <button
                type="button"
                className={'button secondary' + (rating === 1 ? ' pressed' : '')}
                aria-pressed={rating === 1}
                onClick={() => setRating(1)}
              >
                <ThumbsUp size={16} aria-hidden="true" /> Good
              </button>
              <button
                type="button"
                className={'button secondary' + (rating === -1 ? ' pressed' : '')}
                aria-pressed={rating === -1}
                onClick={() => setRating(-1)}
              >
                <ThumbsDown size={16} aria-hidden="true" /> Poor
              </button>
            </div>
            <div className="wf-field">
              <label htmlFor={id + '-comment'}>Comment (optional)</label>
              <textarea
                id={id + '-comment'}
                rows={3}
                value={comment}
                maxLength={MAX.comment}
                placeholder="For example: include the client name in each line"
                onChange={(e) => setComment(e.target.value)}
              />
              <small>A poor rating or a comment teaches the agent for its next runs.</small>
            </div>
            <div className="ag-actions">
              <button
                type="button"
                className="button primary"
                disabled={!rating || sending}
                onClick={() => void sendFeedback()}
              >
                {sending ? 'Saving…' : 'Send feedback'}
              </button>
            </div>
            {lessons.length > 0 && (
              <div className="ag-learnt" role="status">
                <strong>Aeka learnt</strong>
                <ul>
                  {lessons.map((l) => (
                    <li key={l.id}>
                      {l.text} <span className="ag-meta">({SOURCE_LABELS[l.source]})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}
