'use client';
// Drafts: replies prepared on request and not yet sent, newest first, and a short history of sent ones.
// The contract has no drafts list, so this reads the inbox (newest first) in bounded pages.
import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, PencilLine, TriangleAlert } from 'lucide-react';
import { Empty } from '../../workflow/ui/components/Bits';
import { mail } from '../shared/client';
import type { MailItem } from '../shared/types';
import { DRAFT_STATUS_LABELS, errorMessage, formatWhen, plural, senderName } from './lib';
import { MessageDrawer } from './MessageDrawer';
import { useMail } from './store';

const PAGE = 100;
const MAX_PAGES = 5;
const SENT_SHOWN = 10;

export function DraftsPage() {
  const { getEdit, unsavedCount } = useMail();
  const [items, setItems] = useState<MailItem[]>([]);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [partial, setPartial] = useState(false);
  const [showSent, setShowSent] = useState(false);
  const [open, setOpen] = useState<MailItem | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setPhase('loading');
    try {
      const found: MailItem[] = [];
      let before: number | undefined;
      let pages = 0;
      let expected = Infinity;
      for (; pages < MAX_PAGES; pages++) {
        const r = await mail('inbox.list', { view: 'all', limit: PAGE, ...(before ? { before } : {}) });
        expected = r.counts.draftsAwaiting;
        found.push(...r.items.filter((i) => i.draft && i.draft.status !== 'discarded'));
        const waiting = found.filter((i) => i.draft!.status !== 'sent').length;
        if (r.nextBefore == null || (waiting >= expected && found.length - waiting >= SENT_SHOWN)) {
          before = undefined;
          break;
        }
        before = r.nextBefore;
      }
      setPartial(before != null && found.filter((i) => i.draft!.status !== 'sent').length < expected);
      setItems(found);
      setPhase('ready');
    } catch (e) {
      setError(errorMessage(e));
      setPhase('error');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const replace = useCallback((next: MailItem) => {
    setItems((old) => old.map((i) => (i.id === next.id ? { ...i, ...next } : i)));
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

  const byNewest = (a: MailItem, b: MailItem) => b.draft!.updatedAt - a.draft!.updatedAt;
  const waiting = items
    .filter((i) => i.draft!.status === 'draft' || i.draft!.status === 'saved')
    .sort(byNewest);
  const sent = items
    .filter((i) => i.draft!.status === 'sent')
    .sort(byNewest)
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
          {waiting.map((i) => {
            const d = i.draft!;
            return (
              <li key={i.id} className="mail-card mail-draft-card">
                <button type="button" className="mail-card-open" onClick={() => setOpen(i)}>
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
                  <span className="mail-subject">Re: {i.subject || '(No subject)'}</span>
                  <span className="mail-sender">To {senderName(i.from)}</span>
                  <span className="mail-why muted">{i.preview}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty icon={PencilLine} title="No drafts waiting">
          Drafts are made only when you ask for one. Choose Draft reply on an email in Inbox triage.
        </Empty>
      )}
      {partial && (
        <p className="wf-caption">
          Showing drafts on your {PAGE * MAX_PAGES} most recent emails. Older drafts are in Outlook.
        </p>
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
              {sent.map((i) => (
                <li key={i.id} className="mail-low">
                  <button type="button" onClick={() => setOpen(i)}>
                    <span className="mail-low-from">{senderName(i.from)}</span>
                    <span className="mail-low-subject">Re: {i.subject || '(No subject)'}</span>
                    <span className="mail-time">Sent {formatWhen(i.draft!.updatedAt)}</span>
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
