'use client';
// Triage card for one email, and the compact row used for low-priority mail.
import { Briefcase, Check, Paperclip, PencilLine, RotateCcw, UserRound } from 'lucide-react';
import type { MailItem, Tier, Triage } from '../shared/types';
import {
  DRAFT_STATUS_LABELS,
  deadlineBadge,
  formatReceived,
  formatStamp,
  plural,
  senderName,
  tierLabel,
} from './lib';
import { useMail } from './store';

const TIER_TONE: Record<Tier, string> = { 1: 'urgent', 2: 'important', 3: 'routine', 4: 'low' };

export function TierPill({ tier }: { tier: Tier }) {
  return <span className={'mail-tier ' + TIER_TONE[tier]}>{tierLabel(tier)}</span>;
}

export function DeadlineBadge({ deadline }: { deadline: string }) {
  const b = deadlineBadge(deadline);
  return <span className={'wf-pill ' + b.tone}>{b.text}</span>;
}

export function MandateChip({
  triage,
  onConfirm,
  onChange,
  busy,
}: {
  triage: Triage;
  onConfirm?: () => void;
  onChange?: () => void;
  busy?: boolean;
}) {
  const { targetById } = useMail();
  if (!triage.matterId) return null;
  const m = targetById.get(triage.matterId);
  const name = m ? m.title : 'A mandate';
  if (triage.matterConfidence === 'suggested')
    return (
      <span className="mail-chip suggested">
        <Briefcase size={13} aria-hidden="true" />
        <span className="mail-chip-text">
          Suggested: <strong>{name}</strong>
        </span>
        {onConfirm && (
          <button
            type="button"
            className="mail-chip-btn"
            disabled={busy}
            onClick={onConfirm}
            aria-label={`Confirm mandate ${name}`}
          >
            <Check size={14} aria-hidden="true" /> Confirm
          </button>
        )}
        {onChange && (
          <button type="button" className="mail-chip-btn" onClick={onChange} aria-label="Change mandate">
            Change
          </button>
        )}
      </span>
    );
  return (
    <span className="mail-chip">
      <Briefcase size={13} aria-hidden="true" />
      <span className="mail-chip-text">{name}</span>
    </span>
  );
}

export function DelegateChip({ triage }: { triage: Triage }) {
  const { memberName } = useMail();
  if (!triage.delegate) return null;
  return (
    <span className="mail-chip">
      <UserRound size={13} aria-hidden="true" />
      <span className="mail-chip-text">Delegate: {memberName(triage.delegate)}</span>
    </span>
  );
}

export function MailCard({
  item,
  busy,
  error,
  onOpen,
  onDraft,
  onDecline,
  onConfirmMandate,
  onRetry,
}: {
  item: MailItem;
  busy: '' | 'draft' | 'decide' | 'mandate' | 'retry';
  error?: string;
  onOpen: (focus?: 'draft') => void;
  onDraft: () => void;
  onDecline: () => void;
  onConfirmMandate: () => void;
  onRetry: () => void;
}) {
  const t = item.triage;
  const done = t?.status === 'done' || t?.status === 'skipped';
  const asking =
    done && t && (t.replyNeeded === 'yes' || t.replyNeeded === 'maybe') && t.draftDecision === 'undecided';
  const draft = item.draft && item.draft.status !== 'discarded' ? item.draft : null;
  const titleId = 'mail-card-' + item.id;
  return (
    <li
      className={'mail-card' + (t && done ? ' tier-' + t.tier : '') + (item.isRead ? '' : ' unread')}
      aria-labelledby={titleId}
    >
      <div className="mail-card-top">
        <div className="mail-card-pills">
          {t && done && <TierPill tier={t.tier} />}
          {t?.status === 'failed' && <span className="wf-pill red">Could not triage</span>}
          {(!t || t.status === 'pending') && <span className="wf-pill grey">Waiting for triage</span>}
          {t?.deadline && <DeadlineBadge deadline={t.deadline} />}
          {item.repliedByMe && <span className="wf-pill green">Replied</span>}
          {item.hasAttachments && <Paperclip size={14} aria-label="Has attachments" className="mail-clip" />}
        </div>
        <time
          className="mail-time"
          dateTime={new Date(item.receivedAt).toISOString()}
          title={formatStamp(item.receivedAt)}
        >
          {formatReceived(item.receivedAt)}
        </time>
      </div>
      <button type="button" className="mail-card-open" onClick={() => onOpen()}>
        <span id={titleId} className="mail-subject">
          {!item.isRead && <span className="wf-sr">Unread: </span>}
          {item.subject || '(No subject)'}
        </span>
        <span className="mail-sender">{senderName(item.from)}</span>
        {t && done && t.why ? (
          <span className="mail-why">{t.why}</span>
        ) : (
          <span className="mail-why muted">{item.preview}</span>
        )}
      </button>
      {t && done && t.asks.length > 0 && (
        <ul className="mail-asks" aria-label="Asked of you">
          {t.asks.slice(0, 3).map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      )}
      {t?.status === 'failed' && (
        <div className="mail-card-failed">
          <span className="wf-caption">{t.error || 'The AI reply was not usable.'}</span>
          <button type="button" className="button secondary small" disabled={!!busy} onClick={onRetry}>
            <RotateCcw size={14} aria-hidden="true" /> {busy === 'retry' ? 'Trying again' : 'Try again'}
          </button>
        </div>
      )}
      {t && (t.matterId || t.delegate || draft) && (
        <div className="mail-card-chips">
          <MandateChip
            triage={t}
            busy={busy === 'mandate'}
            onConfirm={onConfirmMandate}
            onChange={() => onOpen()}
          />
          <DelegateChip triage={t} />
          {draft && (
            <button type="button" className="mail-chip draft" onClick={() => onOpen('draft')}>
              <PencilLine size={13} aria-hidden="true" />
              <span className="mail-chip-text">
                {DRAFT_STATUS_LABELS[draft.status]}
                {draft.status !== 'sent' && draft.placeholders > 0
                  ? `, ${plural(draft.placeholders, 'detail')} to fill`
                  : ''}
              </span>
            </button>
          )}
        </div>
      )}
      {asking && !draft && (
        <div
          className="mail-question"
          role="group"
          aria-label={'Draft a reply to ' + (item.subject || 'this email')}
        >
          <span className="mail-question-label">
            Draft a reply?
            {t.replyNeeded === 'maybe' && <span className="wf-caption"> A reply may be needed.</span>}
          </span>
          <div className="mail-question-actions">
            <button type="button" className="button primary" disabled={!!busy} onClick={onDraft}>
              <PencilLine size={15} aria-hidden="true" /> {busy === 'draft' ? 'Drafting' : 'Draft reply'}
            </button>
            <button type="button" className="button secondary" disabled={!!busy} onClick={onDecline}>
              {busy === 'decide' ? 'Saving' : 'No reply needed'}
            </button>
          </div>
          {busy === 'draft' && (
            <span className="wf-caption" role="status">
              Drafting your reply. This can take up to a minute.
            </span>
          )}
        </div>
      )}
      {error && (
        <p className="wf-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

export function LowRow({ item, onOpen }: { item: MailItem; onOpen: () => void }) {
  return (
    <li className={'mail-low' + (item.isRead ? '' : ' unread')}>
      <button type="button" onClick={onOpen}>
        <span className="mail-low-from">{senderName(item.from)}</span>
        <span className="mail-low-subject">{item.subject || '(No subject)'}</span>
        <time className="mail-time" dateTime={new Date(item.receivedAt).toISOString()}>
          {formatReceived(item.receivedAt)}
        </time>
      </button>
    </li>
  );
}
