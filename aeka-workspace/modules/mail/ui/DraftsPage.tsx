'use client';
// Drafts: replies prepared on request and not yet sent, newest first, and a short history of sent ones.
import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, PencilLine, TriangleAlert } from 'lucide-react';
import { Empty } from '../../workflow/ui/components/Bits';
import { mail } from '../shared/client';
import type { MailActions } from '../shared/contract';
import type { MailItem } from '../shared/types';
import { DRAFT_STATUS_LABELS, errorMessage, formatWhen, plural, senderName } from './lib';
import { MessageDrawer } from './MessageDrawer';
import { useMail } from './store';

type DraftRow = MailActions['drafts.list']['result'][number];
const SENT_SHOWN = 10;

const fetchDrafts = () => mail('drafts.list', { includeSent: true });

// Enough of the email to open the drawer, which then loads the full message.
const toItem = (r: DraftRow): MailItem => ({
  id: r.messageId,
  conversationId: '',
  subject: r.subject,
  from: r.from,
  to: [],
  cc: [],
  receivedAt: r.receivedAt,
  preview: '',
  hasAttachments: false,
  isRead: true,
  importance: 'normal',
  webLink: '',
  repliedByMe: false,
  threadCount: 1,
  triage: null,
  draft: { id: r.id, status: r.status, placeholders: r.placeholders, updatedAt: r.updatedAt },
});

// The first lines of the reply, without the greeting.
const replyPreview = (body: string) =>
  body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^(dear|hi|hello)\b/i.test(l))
    .slice(0, 2)
    .join(' ');

const recipients = (r: DraftRow) => (r.to.length ? r.to.map(senderName).join(', ') : senderName(r.from));

export function DraftsPage() {
  const { getEdit, unsavedCount } = useMail();
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [showSent, setShowSent] = useState(false);
  const [open, setOpen] = useState<MailItem | null>(null);

  const apply = useCallback((r: DraftRow[]) => {
    setRows(r);
    setPhase('ready');
  }, []);
  const fail = useCallback((e: unknown) => {
    setError(errorMessage(e));
    setPhase('error');
  }, []);
  useEffect(() => {
    let alive = true;
    fetchDrafts().then(
      (r) => alive && apply(r),
      (e) => alive && fail(e),
    );
    return () => {
      alive = false;
    };
  }, [apply, fail]);
  const load = (quiet = false) => {
    if (!quiet) setPhase('loading');
    return fetchDrafts().then(apply, fail);
  };

  // The list is reloaded when the drawer closes; meanwhile only the open email is updated.
  const replace = useCallback((next: MailItem) => {
    setOpen((o) => (o && o.id === next.id ? { ...o, ...next } : o));
  }, []);

  if (phase === 'loading')
    return (
      <p className="wf-loading" role="status">
        Loading your drafts
      </p>
    );
  if (phase === 'error')
    return (
      <Empty
        icon={TriangleAlert}
        title="Drafts could not be loaded"
        action={
          <button type="button" className="button primary" onClick={() => load()}>
            Try again
          </button>
        }
      >
        {error}
      </Empty>
    );

  const waiting = rows.filter((r) => r.status === 'draft' || r.status === 'saved');
  const sent = rows
    .filter((r) => r.status === 'sent')
    .sort((a, b) => (b.sentAt ?? b.updatedAt) - (a.sentAt ?? a.updatedAt))
    .slice(0, SENT_SHOWN);

  return (
    <div className="mail-drafts">
      {unsavedCount > 0 && (
        <p className="wf-note" role="status">
          {plural(unsavedCount, 'draft has', 'drafts have')} unsaved edits in this tab. Open the draft to save
          them.
        </p>
      )}
      {waiting.length ? (
        <ul className="mail-list" aria-label="Drafts to review">
          {waiting.map((d) => (
            <li key={d.id} className="mail-card mail-draft-card">
              <button type="button" className="mail-card-open" onClick={() => setOpen(toItem(d))}>
                <span className="mail-card-top">
                  <span className="mail-card-pills">
                    <span className={'wf-pill ' + (d.status === 'saved' ? 'blue' : 'tint')}>
                      {DRAFT_STATUS_LABELS[d.status]}
                    </span>
                    {d.placeholders > 0 && (
                      <span className="wf-pill amber">{plural(d.placeholders, 'detail')} to fill</span>
                    )}
                    {getEdit(d.id) && <span className="wf-pill grey">Unsaved edits</span>}
                  </span>
                  <span className="mail-time">{formatWhen(d.updatedAt)}</span>
                </span>
                <span className="mail-subject">Re: {d.subject || '(No subject)'}</span>
                <span className="mail-sender">To {recipients(d)}</span>
                <span className="mail-why muted">{replyPreview(d.body)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty icon={PencilLine} title="No drafts waiting">
          Drafts are made only when you ask for one. Choose Draft reply on an email in Inbox triage.
        </Empty>
      )}

      {sent.length > 0 && (
        <section className="mail-low-group" aria-label="Recently sent">
          <button
            type="button"
            className="mail-low-toggle"
            aria-expanded={showSent}
            onClick={() => setShowSent((s) => !s)}
          >
            <span>Recently sent ({sent.length})</span>
            {showSent ? (
              <ChevronUp size={16} aria-hidden="true" />
            ) : (
              <ChevronDown size={16} aria-hidden="true" />
            )}
          </button>
          {showSent && (
            <ul className="mail-low-list">
              {sent.map((d) => (
                <li key={d.id} className="mail-low">
                  <button type="button" onClick={() => setOpen(toItem(d))}>
                    <span className="mail-low-from">{recipients(d)}</span>
                    <span className="mail-low-subject">Re: {d.subject || '(No subject)'}</span>
                    <span className="mail-time">Sent {formatWhen(d.sentAt ?? d.updatedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {open && (
        <MessageDrawer
          key={open.id}
          item={open}
          focus="draft"
          onClose={() => {
            setOpen(null);
            void load(true);
          }}
          onChange={replace}
        />
      )}
    </div>
  );
}
