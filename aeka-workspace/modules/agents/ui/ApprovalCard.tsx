'use client';
// One thing an agent wants to do that leaves the workspace or changes shared records: approve it,
// review it first where it lives, or reject it (with an optional reason, which teaches the agent).
import { useId, useState } from 'react';
import { Check, ExternalLink, Mail, ListPlus, X } from 'lucide-react';
import { StatusPill } from '../../workflow/ui/components/Bits';
import { agents } from '../shared/client';
import type { Approval, ApprovalStatus } from '../shared/types';
import { atLabel, errorMessage, learnt, MAX } from './lib';

const STATUS: Record<ApprovalStatus, { label: string; tone: 'amber' | 'green' | 'grey' | 'red' }> = {
  pending: { label: 'Waiting for you', tone: 'amber' },
  approved: { label: 'Approved', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'grey' },
  failed: { label: 'Could not be done', tone: 'red' },
  expired: { label: 'Expired', tone: 'grey' },
};

export function ApprovalCard({
  approval: a,
  onDecided,
  openLink,
  notify,
  showAgent = true,
}: {
  approval: Approval;
  onDecided: (a: Approval) => void;
  openLink: (link: string) => void;
  notify: (m: string) => void;
  showAgent?: boolean;
}) {
  const id = useId();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const Icon = a.action === 'send_email' ? Mail : ListPlus;

  const decide = async (approve: boolean) => {
    setBusy(true);
    setError('');
    try {
      const r = await agents('approval.decide', {
        id: a.id,
        approve,
        ...(!approve && reason.trim() ? { reason: reason.trim() } : {}),
      });
      const done = r.approval;
      const head =
        done.status === 'failed'
          ? `It could not be done${done.result ? ': ' + done.result : '.'}`
          : `${approve ? 'Approved.' : 'Rejected.'}${done.result ? ' ' + done.result : ''}`;
      notify(head + learnt(r.lessons));
      setRejecting(false);
      onDecided(done);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const pending = a.status === 'pending';
  return (
    <article className={'ag-card ag-approval' + (pending ? ' pending' : '')} aria-labelledby={id + '-t'}>
      <div className="ag-approval-head">
        <Icon size={18} aria-hidden="true" />
        <div>
          {showAgent && <span className="ag-eyebrow">{a.agentName}</span>}
          <h3 id={id + '-t'}>{a.title}</h3>
        </div>
        {!pending && <StatusPill value={a.status} {...STATUS[a.status]} />}
      </div>
      {a.detail && (
        <div className="ag-detail" tabIndex={0} role="region" aria-label="What will be done">
          {a.detail}
        </div>
      )}
      {a.reason && (
        <p className="ag-why">
          <strong>Why:</strong> {a.reason}
        </p>
      )}
      {!pending && a.result && <p className="ag-why">{a.result}</p>}
      <p className="ag-meta">
        Asked {atLabel(a.createdAt)}
        {a.decidedAt ? `, decided ${atLabel(a.decidedAt)}` : ''}
      </p>
      {error && (
        <p className="ag-error" role="alert">
          {error}
        </p>
      )}
      {pending && !rejecting && (
        <div className="ag-actions">
          <button type="button" className="button primary" disabled={busy} onClick={() => void decide(true)}>
            <Check size={16} aria-hidden="true" /> {busy ? 'Approving…' : 'Approve'}
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => setRejecting(true)}
          >
            <X size={16} aria-hidden="true" /> Reject
          </button>
          {a.link && (
            <button type="button" className="button secondary" onClick={() => openLink(a.link)}>
              <ExternalLink size={16} aria-hidden="true" /> Review first
            </button>
          )}
        </div>
      )}
      {pending && rejecting && (
        <div className="ag-reject">
          <div className="wf-field">
            <label htmlFor={id + '-reason'}>Why not? (optional, it helps the agent learn)</label>
            <input
              id={id + '-reason'}
              type="text"
              value={reason}
              maxLength={MAX.reason}
              autoFocus
              placeholder="For example: never write to clients on a Sunday"
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void decide(false);
              }}
            />
          </div>
          <div className="ag-actions">
            <button
              type="button"
              className="button danger"
              disabled={busy}
              onClick={() => void decide(false)}
            >
              <X size={16} aria-hidden="true" /> {busy ? 'Rejecting…' : 'Reject'}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setRejecting(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
