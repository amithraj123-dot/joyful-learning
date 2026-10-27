'use client';
// Triage card for one email, and the compact row used for low-priority mail.
import {
  Archive,
  Briefcase,
  CalendarX2,
  Check,
  ExternalLink,
  Paperclip,
  PencilLine,
  RotateCcw,
  Star,
  StarOff,
  UserRound,
} from 'lucide-react';
import type { MailItem, Tier, Triage } from '../shared/types';
import {
  DRAFT_STATUS_LABELS,
  deadlineBadge,
  formatReceived,
  formatStamp,
  plural,
  safeWebLink,
  senderName,
  tierLabel,
} from './lib';
import { MoreMenu } from './Menu';
import { useMail } from './store';

export type CardBusy = '' | 'draft' | 'decide' | 'mandate' | 'retry' | 'archive' | 'vip';

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

// The sender (or their domain) is one of my VIPs.
export function VipMark() {
  return (
    <span className="mail-vip" title="One of your VIPs">
      <Star size={12} aria-hidden="true" /> VIP
    </span>
  );
}

// "Chased 3 times": the sender has written more than once since my last reply.
export function ChasedBadge({ n }: { n: number }) {
  if (!(n >= 2)) return null;
  return <span className="wf-pill amber">Chased {n} times</span>;
}

// For meeting invitations: what it clashes with in my calendar.
export function ClashLine({ clash }: { clash: string | null | undefined }) {
  if (!clash) return null;
  return (
    <p className="mail-clash">
      <CalendarX2 size={14} aria-hidden="true" />
      <span>Clashes with {clash}</span>
    </p>
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
  onArchive,
  onVip,
}: {
  item: MailItem;
  busy: CardBusy;
  error?: string;
  onOpen: (focus?: 'draft') => void;
  onDraft: () => void;
  onDecline: () => void;
  onConfirmMandate: () => void;
  onRetry: () => void;
  onArchive: () => void;
  onVip: (on: boolean) => void;
}) {
  const t = item.triage;
  const done = t?.status === 'done' || t?.status === 'skipped';
  const asking =
    done && t && (t.replyNeeded === 'yes' || t.replyNeeded === 'maybe') && t.draftDecision === 'undecided';
  const draft = item.draft && item.draft.status !== 'discarded' ? item.draft : null;
  const titleId = 'mail-card-' + item.id;
  const web = safeWebLink(item.webLink);
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
          {item.vip && <VipMark />}
          <ChasedBadge n={item.chased} />
          {item.repliedByMe && <span className="wf-pill green">Replied</span>}
          {done && t?.draftDecision === 'declined' && !item.repliedByMe && (
            <span className="wf-pill grey">No reply needed</span>
          )}
          {item.hasAttachments && <Paperclip size={14} aria-label="Has attachments" className="mail-clip" />}
        </div>
        <span className="mail-card-corner">
          <time
            className="mail-time"
            dateTime={new Date(item.receivedAt).toISOString()}
            title={formatStamp(item.receivedAt)}
          >
            {formatReceived(item.receivedAt)}
          </time>
          <MoreMenu
            label={'More actions for ' + (item.subject || 'this email')}
            items={[
              {
                label: busy === 'archive' ? 'Archiving' : 'Archive',
                icon: Archive,
                onSelect: onArchive,
                disabled: !!busy,
              },
              item.vip
                ? {
                    label: 'Remove sender from VIPs',
                    icon: StarOff,
                    onSelect: () => onVip(false),
                    disabled: !!busy,
                  }
                : { label: 'Mark sender as VIP', icon: Star, onSelect: () => onVip(true), disabled: !!busy },
              ...(web ? [{ label: 'Open in Outlook', icon: ExternalLink, href: web }] : []),
            ]}
          />
        </span>
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
      <ClashLine clash={item.meetingClash} />
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
      {(busy === 'archive' || busy === 'vip') && (
        <p className="wf-caption" role="status">
          {busy === 'archive' ? 'Archiving' : 'Updating your VIPs'}
        </p>
      )}
      {error && (
        <p className="wf-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

export function LowRow({
  item,
  onOpen,
  onArchive,
  busy,
  error,
}: {
  item: MailItem;
  onOpen: () => void;
  onArchive: () => void;
  busy?: boolean;
  error?: string;
}) {
  const subject = item.subject || '(No subject)';
  return (
    <li className={'mail-low' + (item.isRead ? '' : ' unread')}>
      <div className="mail-low-row">
        <button type="button" className="mail-low-open" onClick={onOpen}>
          <span className="mail-low-from">
            {item.vip && <Star size={12} aria-label="VIP" className="mail-vip-star" />}
            {senderName(item.from)}
          </span>
          <span className="mail-low-subject">{subject}</span>
          <time className="mail-time" dateTime={new Date(item.receivedAt).toISOString()}>
            {formatReceived(item.receivedAt)}
          </time>
        </button>
        <button
          type="button"
          className="mail-low-archive"
          disabled={busy}
          onClick={onArchive}
          aria-label={'Archive ' + subject}
          title="Archive"
        >
          <Archive size={16} aria-hidden="true" />
        </button>
      </div>
      {error && (
        <p className="wf-error mail-low-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
