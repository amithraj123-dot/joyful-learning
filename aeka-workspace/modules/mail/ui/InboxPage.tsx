'use client';
// Inbox triage: what needs the partner, with "Draft a reply?" asked on each email that may need one.
// Syncs on open and every 3 minutes while the tab is visible.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, ChevronDown, ChevronUp, Inbox, Plug, RefreshCw, Search, TriangleAlert } from 'lucide-react';
import { clear, peek } from '../../../core/client/handover';
import { Empty } from '../../workflow/ui/components/Bits';
import { Modal } from '../../workflow/ui/components/Modal';
import { mail } from '../shared/client';
import { VIEWS, VIEW_LABELS, type MailItem, type MailView, type QueueCounts } from '../shared/types';
import { domainOf, errorMessage, formatWhen, isConflict, isLow, plural, senderName } from './lib';
import { LowRow, MailCard, type CardBusy } from './MailCard';
import { MessageDrawer } from './MessageDrawer';
import { useMail } from './store';
import { archiveIds, clearVip, markVip, vipRuleFor } from './actions';

const SYNC_EVERY = 3 * 60 * 1000;
const VIEW_KEY = 'aeka-mail-view';
type Busy = CardBusy;

// Bulk archive leaves out VIPs and mail linked to a mandate; they can still be archived one by one.
const keepOnBulk = (i: MailItem) => i.vip || !!i.triage?.matterId;

const EMPTY_TEXT: Record<MailView, { title: string; body: string }> = {
  needs_me: {
    title: 'Nothing needs you right now',
    body: 'New emails that need your reply or attention appear here.',
  },
  review: {
    title: 'Nothing to review',
    body: 'Emails asking you to review a document or position appear here.',
  },
  delegate: {
    title: 'Nothing to delegate',
    body: 'Emails the team can handle appear here, with a suggested person.',
  },
  info: {
    title: 'Nothing for information',
    body: 'Updates you may want to read, without action, appear here.',
  },
  low: { title: 'No low-priority mail', body: 'Newsletters, notifications and other noise appear here.' },
  all: { title: 'No email yet', body: 'Your inbox is empty, or the first sync has not finished.' },
  failed: { title: 'Everything was triaged', body: 'Emails that could not be triaged appear here.' },
};

function readView(): MailView {
  try {
    const v = localStorage.getItem(VIEW_KEY) as MailView | null;
    if (v && (VIEWS as readonly string[]).includes(v)) return v;
  } catch {}
  return 'needs_me';
}

export function InboxPage() {
  const { account, reloadAccount, navigate, notify } = useMail();
  const [view, setViewState] = useState<MailView>(readView);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<MailItem[]>([]);
  const [counts, setCounts] = useState<QueueCounts | null>(null);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [more, setMore] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [syncError, setSyncError] = useState('');
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [busy, setBusy] = useState<Record<string, Busy>>({});
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [showLow, setShowLow] = useState(false);
  const [open, setOpen] = useState<{ item: MailItem; focus?: 'draft' } | null>(null);
  const [bulk, setBulk] = useState<MailItem[] | null>(null);
  const seq = useRef(0);

  // Another module (for example the assistant) asked for one email to be opened.
  useEffect(() => {
    const wanted = peek('mail.item');
    if (!wanted) return;
    clear('mail.item');
    // No cleanup guard: the hand-over is taken once, so its result must be shown even if React
    // re-runs this effect (development checks do).
    void mail('message.get', { id: wanted.itemId })
      .then((item) => setOpen({ item }))
      .catch(() => setNotice('That email is no longer in your mailbox.'));
  }, []);

  const acct = account.account;
  const connected = !!acct && acct.status !== 'disconnected';

  const setView = (v: MailView) => {
    setViewState(v);
    setShowLow(false);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(
    async (quiet = false) => {
      const mine = ++seq.current;
      if (!quiet) setPhase('loading');
      try {
        const r = await mail('inbox.list', { view, ...(query ? { search: query } : {}), limit: 50 });
        if (mine !== seq.current) return;
        setItems(r.items);
        setCounts(r.counts);
        setNextBefore(r.nextBefore);
        setPhase('ready');
        setError('');
      } catch (e) {
        if (mine !== seq.current) return;
        setError(errorMessage(e));
        setPhase('error');
      }
    },
    [view, query],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    if (nextBefore == null) return;
    setMore(true);
    try {
      const r = await mail('inbox.list', {
        view,
        ...(query ? { search: query } : {}),
        before: nextBefore,
        limit: 50,
      });
      setItems((old) => [...old, ...r.items.filter((n) => !old.some((o) => o.id === n.id))]);
      setCounts(r.counts);
      setNextBefore(r.nextBefore);
    } catch (e) {
      setNotice(errorMessage(e));
    } finally {
      setMore(false);
    }
  };

  const syncing$ = useRef(false);
  const sync = useCallback(async () => {
    if (syncing$.current) return;
    syncing$.current = true;
    setSyncing(true);
    setSyncError('');
    setSyncMsg('Syncing with Outlook');
    try {
      const r = await mail('sync', {});
      setLastSync(Date.now());
      setSyncMsg(
        r.fetched
          ? `Synced. ${plural(r.fetched, 'new email')}, ${r.triaged} triaged${r.pending ? `, ${r.pending} waiting` : ''}.`
          : 'Synced. No new email.',
      );
      await load(true);
      void reloadAccount();
    } catch (e) {
      setSyncMsg('');
      setSyncError(errorMessage(e));
    } finally {
      syncing$.current = false;
      setSyncing(false);
    }
  }, [load, reloadAccount]);

  // Sync once when the inbox opens with a connected account, then every 3 minutes while visible.
  const syncRef = useRef(sync);
  useEffect(() => {
    syncRef.current = sync;
  }, [sync]);
  const lastRun = useRef(0);
  useEffect(() => {
    if (!connected || acct?.status !== 'connected') return;
    const run = () => {
      lastRun.current = Date.now();
      void syncRef.current();
    };
    run();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') run();
    }, SYNC_EVERY);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRun.current > SYNC_EVERY) run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [connected, acct?.status]);

  const replace = useCallback((next: MailItem) => {
    setItems((old) => old.map((i) => (i.id === next.id ? { ...i, ...next } : i)));
    setOpen((o) => (o && o.item.id === next.id ? { ...o, item: { ...o.item, ...next } } : o));
  }, []);

  const act = async (item: MailItem, kind: Busy, fn: () => Promise<void>) => {
    setBusy((b) => ({ ...b, [item.id]: kind }));
    setCardErrors((c) => ({ ...c, [item.id]: '' }));
    try {
      await fn();
    } catch (e) {
      if (isConflict(e)) {
        setNotice('An email changed elsewhere, so the list has been reloaded.');
        await load(true);
      } else setCardErrors((c) => ({ ...c, [item.id]: errorMessage(e) }));
    } finally {
      setBusy((b) => ({ ...b, [item.id]: '' }));
    }
  };

  const draftReply = (item: MailItem) =>
    act(item, 'draft', async () => {
      const d = await mail('draft.create', { id: item.id });
      const next: MailItem = {
        ...item,
        triage: item.triage ? { ...item.triage, draftDecision: 'wanted' } : item.triage,
        draft: { id: d.id, status: d.status, placeholders: d.placeholders, updatedAt: d.updatedAt },
      };
      replace(next);
      setCounts((c) =>
        c
          ? {
              ...c,
              decisionsAwaiting: Math.max(0, c.decisionsAwaiting - 1),
              draftsAwaiting: c.draftsAwaiting + 1,
            }
          : c,
      );
      setOpen({ item: next, focus: 'draft' });
    });
  const decline = (item: MailItem) =>
    act(item, 'decide', async () => {
      if (!item.triage) return;
      const t = await mail('triage.decide', {
        id: item.id,
        wantDraft: false,
        baseRevision: item.triage.revision,
      });
      replace({ ...item, triage: t });
      setCounts((c) => (c ? { ...c, decisionsAwaiting: Math.max(0, c.decisionsAwaiting - 1) } : c));
    });
  const confirmMandate = (item: MailItem) =>
    act(item, 'mandate', async () => {
      if (!item.triage?.matterId) return;
      const t = await mail('triage.correct', {
        id: item.id,
        changes: { matterId: item.triage.matterId },
        baseRevision: item.triage.revision,
      });
      replace({ ...item, triage: t });
    });
  const retry = (item: MailItem) =>
    act(item, 'retry', async () => {
      const t = await mail('triage.retry', { id: item.id });
      replace({ ...item, triage: t });
    });

  const removeItems = useCallback((ids: string[]) => {
    const gone = new Set(ids);
    setItems((old) => old.filter((i) => !gone.has(i.id)));
    setOpen((o) => (o && gone.has(o.item.id) ? null : o));
  }, []);
  const archive = (item: MailItem) =>
    act(item, 'archive', async () => {
      const n = await archiveIds([item.id]);
      if (!n) throw new Error('Outlook did not archive this email. It may have been moved already.');
      removeItems([item.id]);
      notify('Moved to your Outlook Archive folder');
      void load(true);
    });
  const vip = (item: MailItem, on: boolean) =>
    act(item, 'vip', async () => {
      const who = senderName(item.from);
      const address = item.from.address.toLowerCase();
      let match = (i: MailItem) => i.from.address.toLowerCase() === address;
      if (on) {
        await markVip('sender', address);
        notify(`${who} is now a VIP. New email from them is at least Important and never archived.`);
      } else {
        const rule = await vipRuleFor(address);
        if (rule) await clearVip(rule);
        if (rule?.kind === 'domain') {
          match = (i) => domainOf(i.from.address) === rule.pattern;
          notify(`Everyone at ${rule.pattern} is no longer a VIP.`);
        } else notify(`${who} is no longer a VIP.`);
      }
      setItems((old) => old.map((i) => (match(i) ? { ...i, vip: on } : i)));
      void load(true);
    });

  const shown = useMemo(() => {
    if (view !== 'needs_me') return items;
    // Urgent first in "Needs me"; otherwise newest first as the server sends them.
    return [...items].sort(
      (a, b) => (a.triage?.tier ?? 3) - (b.triage?.tier ?? 3) || b.receivedAt - a.receivedAt,
    );
  }, [items, view]);
  const main = view === 'low' ? [] : shown.filter((i) => !isLow(i));
  const low = view === 'low' ? shown : shown.filter(isLow);
  const lowArchivable = low.filter((i) => !keepOnBulk(i));
  const lowKept = low.length - lowArchivable.length;

  if (account.phase === 'ready' && !connected)
    return (
      <Empty
        icon={Plug}
        title="Connect Outlook to start"
        action={
          <button type="button" className="button primary" onClick={() => navigate('mail/connect')}>
            Set up the Outlook connection
          </button>
        }
      >
        Connect your own mailbox and the workspace sorts what needs you, what can wait and what can go to the
        team. Nothing is sent without your review.
      </Empty>
    );

  const chips = VIEWS.filter((v) => v !== 'failed' || (counts?.failed ?? 0) > 0);
  const lastSyncAt = lastSync ?? acct?.lastSyncAt ?? null;

  return (
    <div className="mail-inbox">
      {acct?.status === 'reauth' && (
        <div className="wf-note mail-banner" role="status">
          <span>Outlook asks you to sign in again before mail can sync.</span>
          <a className="button primary small" href="/api/mail/connect">
            Reconnect
          </a>
        </div>
      )}

      {counts && (
        <div className="mail-strip" role="group" aria-label="Summary">
          <button
            type="button"
            className={'mail-stat' + (counts.urgent ? ' hot' : '')}
            onClick={() => setView('needs_me')}
          >
            <strong>{counts.urgent}</strong>
            <span>Urgent</span>
          </button>
          <button type="button" className="mail-stat" onClick={() => setView('needs_me')}>
            <strong>{counts.decisionsAwaiting}</strong>
            <span>Draft a reply?</span>
          </button>
          <button type="button" className="mail-stat" onClick={() => navigate('mail/drafts')}>
            <strong>{counts.draftsAwaiting}</strong>
            <span>Drafts to send</span>
          </button>
        </div>
      )}

      <div className="mail-toolbar">
        <label className="search-box mail-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search subject, sender or text"
            aria-label="Search mail"
          />
        </label>
        <div className="mail-sync">
          <button
            type="button"
            className="button secondary"
            onClick={() => void sync()}
            disabled={syncing || !connected || acct?.status !== 'connected'}
          >
            <RefreshCw size={15} aria-hidden="true" className={syncing ? 'mail-spin' : ''} />
            {syncing ? 'Syncing' : 'Sync now'}
          </button>
          <span className="wf-sr" aria-live="polite">
            {syncing ? '' : syncMsg}
          </span>
          <span className="wf-caption">
            {syncing
              ? 'Syncing with Outlook'
              : lastSyncAt
                ? 'Last synced ' + formatWhen(lastSyncAt)
                : 'Not synced yet'}
            {counts && counts.pending > 0 ? `. ${counts.pending} waiting for triage` : ''}
          </span>
        </div>
      </div>
      {syncError && (
        <p className="wf-error" role="alert">
          Sync did not finish: {syncError}
        </p>
      )}

      <div className="wf-chips mail-views" role="group" aria-label="Show">
        {chips.map((v) => {
          const n = v === 'all' ? null : (counts?.[v] ?? null);
          return (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              className={'wf-chip' + (view === v ? ' active' : '') + (v === 'failed' ? ' warn' : '')}
              onClick={() => setView(v)}
            >
              {VIEW_LABELS[v]}
              {n != null && <span className="wf-count">{n}</span>}
            </button>
          );
        })}
      </div>

      {notice && (
        <p className="wf-note" role="status">
          {notice}{' '}
          <button type="button" className="wf-link" onClick={() => setNotice('')}>
            Dismiss
          </button>
        </p>
      )}

      {phase === 'loading' && !items.length ? (
        <p className="wf-loading" role="status">
          Loading your inbox
        </p>
      ) : phase === 'error' ? (
        <Empty
          icon={TriangleAlert}
          title="The inbox could not be loaded"
          action={
            <button type="button" className="button primary" onClick={() => load()}>
              Try again
            </button>
          }
        >
          {error}
        </Empty>
      ) : !shown.length ? (
        <Empty icon={Inbox} title={query ? 'No email matches your search' : EMPTY_TEXT[view].title}>
          {query ? 'Try other words, or clear the search.' : EMPTY_TEXT[view].body}
        </Empty>
      ) : (
        <>
          {main.length > 0 && (
            <ul className="mail-list" aria-label={VIEW_LABELS[view]} aria-busy={phase === 'loading'}>
              {main.map((item) => (
                <MailCard
                  key={item.id}
                  item={item}
                  busy={busy[item.id] ?? ''}
                  error={cardErrors[item.id]}
                  onOpen={(focus) => setOpen({ item, focus })}
                  onDraft={() => draftReply(item)}
                  onDecline={() => decline(item)}
                  onConfirmMandate={() => confirmMandate(item)}
                  onRetry={() => retry(item)}
                  onArchive={() => archive(item)}
                  onVip={(on) => vip(item, on)}
                />
              ))}
            </ul>
          )}
          {low.length > 0 && (
            <section className="mail-low-group" aria-label="Low priority and noise">
              {view !== 'low' && (
                <button
                  type="button"
                  className="mail-low-toggle"
                  aria-expanded={showLow}
                  onClick={() => setShowLow((s) => !s)}
                >
                  <span>
                    {plural(low.length, 'low-priority email')} {showLow ? 'shown' : 'hidden'}
                  </span>
                  {showLow ? (
                    <ChevronUp size={16} aria-hidden="true" />
                  ) : (
                    <ChevronDown size={16} aria-hidden="true" />
                  )}
                </button>
              )}
              {(view === 'low' || showLow) && (
                <>
                  <div className="mail-low-bar">
                    <span className="wf-caption">
                      {lowKept
                        ? `${plural(lowKept, 'email')} from VIPs or linked to a mandate ${lowKept === 1 ? 'is' : 'are'} kept out of bulk archive.`
                        : 'Clear low-priority mail in one go, or archive one at a time.'}
                    </span>
                    {lowArchivable.length > 0 && (
                      <button
                        type="button"
                        className="button secondary small"
                        onClick={() => setBulk(lowArchivable)}
                      >
                        <Archive size={14} aria-hidden="true" /> Archive all {lowArchivable.length} shown
                      </button>
                    )}
                  </div>
                  <ul className="mail-low-list">
                    {low.map((item) => (
                      <LowRow
                        key={item.id}
                        item={item}
                        busy={!!busy[item.id]}
                        error={cardErrors[item.id]}
                        onOpen={() => setOpen({ item })}
                        onArchive={() => archive(item)}
                      />
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}
          {nextBefore != null && (
            <button type="button" className="button secondary mail-more" disabled={more} onClick={loadMore}>
              {more ? 'Loading' : 'Show older email'}
            </button>
          )}
        </>
      )}

      {open && (
        <MessageDrawer
          key={open.item.id}
          item={open.item}
          focus={open.focus}
          onClose={() => {
            setOpen(null);
            void load(true);
          }}
          onChange={replace}
          onArchived={(id) => {
            removeItems([id]);
            void load(true);
          }}
        />
      )}
      {bulk && (
        <BulkArchive
          items={bulk}
          onClose={() => setBulk(null)}
          onDone={(archived, ids) => {
            setBulk(null);
            if (archived === ids.length) removeItems(ids);
            notify(
              archived === ids.length
                ? `${plural(archived, 'email')} moved to your Outlook Archive folder`
                : `${archived} of ${ids.length} emails archived. The others stay in your inbox.`,
            );
            void load(true);
          }}
        />
      )}
    </div>
  );
}

function BulkArchive({
  items,
  onClose,
  onDone,
}: {
  items: MailItem[];
  onClose: () => void;
  onDone: (archived: number, ids: string[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setBusy(true);
    setError('');
    const ids = items.map((i) => i.id);
    try {
      onDone(await archiveIds(ids), ids);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  const first = items.slice(0, 5);
  return (
    <Modal
      title={`Archive ${plural(items.length, 'low-priority email')}?`}
      subtitle="They move to the Archive folder in your Outlook and leave the triage views."
      onClose={busy ? () => {} : onClose}
      footer={
        <div className="wf-row wf-between">
          <button type="button" className="button ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="button primary" onClick={go} disabled={busy} data-autofocus>
            <Archive size={15} aria-hidden="true" /> {busy ? 'Archiving' : `Archive ${items.length}`}
          </button>
        </div>
      }
    >
      <ul className="mail-bulk-list">
        {first.map((i) => (
          <li key={i.id}>
            <strong>{senderName(i.from)}</strong> <span>{i.subject || '(No subject)'}</span>
          </li>
        ))}
        {items.length > first.length && (
          <li className="wf-caption">and {plural(items.length - first.length, 'more email')}</li>
        )}
      </ul>
      <p className="wf-caption">
        This cannot be undone from the workspace. To bring an email back, move it out of the Archive folder in
        Outlook. Mail from VIPs and mail linked to a mandate is not included.
      </p>
      {busy && (
        <p className="wf-caption" role="status">
          Archiving
        </p>
      )}
      {error && (
        <p className="wf-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
