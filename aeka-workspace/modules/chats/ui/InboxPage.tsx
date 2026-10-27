'use client';
// Chats: what is waiting for my reply across WhatsApp, LinkedIn, Gmail, SMS, Teams and Slack, read
// from my phone's notifications. Refreshes every minute while visible; inside the Android app it also
// asks the phone to send what it has queued.
import { useCallback, useEffect, useRef, useState } from 'react';
import { BellRing, MessagesSquare, RefreshCw, Search, Smartphone, Star, TriangleAlert } from 'lucide-react';
import { clear, peek } from '../../../core/client/handover';
import { Chips, Empty } from '../../workflow/ui/components/Bits';
import { chats } from '../shared/client';
import {
  APP_LABELS,
  APPS,
  TIER_LABELS,
  type AppId,
  type ChatThread,
  type ChatView,
  type PhoneDevice,
  type QueueCounts,
} from '../shared/types';
import {
  inAndroidApp,
  onAndroidEvent,
  openPhoneSettings,
  phoneStatus,
  syncPhone,
  type PhoneStatus,
} from './android';
import { errorMessage, initials, plural, waitedLabel, whenLabel } from './lib';
import { ThreadDrawer } from './ThreadDrawer';

const REFRESH_MS = 60 * 1000;
const VIEW_KEY = 'aeka-chats-view';
const VIEWS: { id: ChatView; label: string }[] = [
  { id: 'needs', label: 'Needs reply' },
  { id: 'waiting', label: 'Waiting on them' },
  { id: 'all', label: 'All' },
  { id: 'low', label: 'Low' },
  { id: 'muted', label: 'Muted' },
];
const EMPTY: Record<ChatView, { title: string; body: string }> = {
  needs: { title: 'Nothing is waiting for your reply', body: 'Messages that need an answer appear here.' },
  waiting: { title: 'Nobody owes you a reply', body: 'Chats where you replied last appear here for a week.' },
  all: { title: 'No chats yet', body: 'Messages appear here once your phone is connected.' },
  low: { title: 'Nothing low-priority', body: 'Promotions, bank alerts and other noise appear here.' },
  muted: { title: 'No muted chats', body: 'Chats you mute are kept here and never nudged.' },
};

function readView(): ChatView {
  try {
    const v = localStorage.getItem(VIEW_KEY) as ChatView | null;
    if (v && VIEWS.some((x) => x.id === v)) return v;
  } catch {}
  return 'needs';
}

export function InboxPage({
  navigate,
  notify,
}: {
  navigate: (p: string) => void;
  notify: (m: string) => void;
}) {
  const [view, setViewState] = useState<ChatView>(readView);
  const [app, setApp] = useState<AppId | ''>('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [counts, setCounts] = useState<QueueCounts | null>(null);
  const [devices, setDevices] = useState<PhoneDevice[] | null>(null);
  const [phone, setPhone] = useState<PhoneStatus | null>(() => phoneStatus());
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<string | null>(() => peek('chats.thread')?.threadId ?? null);
  const seq = useRef(0);

  useEffect(() => clear('chats.thread'), []);

  const setView = (v: ChatView) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(
    async (quiet = false) => {
      const mine = ++seq.current;
      if (!quiet) setPhase('loading');
      try {
        const r = await chats('threads.list', {
          view,
          ...(app ? { app } : {}),
          ...(query ? { search: query } : {}),
          limit: 60,
        });
        if (mine !== seq.current) return;
        setThreads(r.threads);
        setCounts(r.counts);
        setPhase('ready');
        setError('');
      } catch (e) {
        if (mine !== seq.current) return;
        setError(errorMessage(e));
        setPhase('error');
      }
    },
    [view, app, query],
  );

  // The first load runs after the effect (never setting state within it).
  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);

  useEffect(() => {
    void chats('phone.status', {})
      .then((s) => setDevices(s.devices))
      .catch(() => setDevices([]));
  }, []);

  // Inside the app: ask the phone for its queue, then triage and reload.
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (inAndroidApp()) await syncPhone();
      await chats('run', {});
      setPhone(phoneStatus());
      await load(true);
    } catch (e) {
      notify(errorMessage(e));
    } finally {
      setRefreshing(false);
    }
  }, [load, notify]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, REFRESH_MS);
    const off = inAndroidApp()
      ? onAndroidEvent((e) => {
          if (e.type === 'synced') {
            setPhone(phoneStatus());
            void load(true);
          }
        })
      : () => {};
    return () => {
      clearInterval(id);
      off();
    };
  }, [load]);

  const noPhone = devices != null && devices.length === 0;
  const needsAccess = phone && phone.paired && !phone.notificationAccess;
  const hidden = phone?.previewsHidden ?? [];

  return (
    <div className="ch-inbox">
      {noPhone && !phone?.paired && (
        <div className="ch-card ch-banner">
          <Smartphone size={22} aria-hidden="true" />
          <div>
            <strong>Connect your Android phone</strong>
            <p>
              The Aeka app reads WhatsApp, LinkedIn, SMS, Teams, Slack and Gmail notifications on your phone,
              so messages that need a reply are never missed.
            </p>
          </div>
          <button type="button" className="button primary" onClick={() => navigate('chats/phone')}>
            Set up
          </button>
        </div>
      )}
      {needsAccess && (
        <div className="ch-card ch-banner warn" role="alert">
          <TriangleAlert size={22} aria-hidden="true" />
          <div>
            <strong>Allow notification access</strong>
            <p>The app cannot read messages until you allow notification access for Aeka.</p>
          </div>
          <button type="button" className="button primary" onClick={() => openPhoneSettings('notifications')}>
            Allow
          </button>
        </div>
      )}
      {hidden.length > 0 && (
        <div className="ch-card ch-banner warn">
          <TriangleAlert size={22} aria-hidden="true" />
          <div>
            <strong>Message previews are off in {hidden.map((a) => APP_LABELS[a]).join(', ')}</strong>
            <p>Turn on notification previews in that app so Aeka can read new messages.</p>
          </div>
        </div>
      )}

      <div className="ch-strip">
        <button
          type="button"
          className={'ch-stat' + (counts?.needs ? ' hot' : '')}
          onClick={() => setView('needs')}
        >
          <strong>{counts?.needs ?? '·'}</strong>
          <span>Need your reply</span>
        </button>
        <button type="button" className="ch-stat" onClick={() => setView('waiting')}>
          <strong>{counts?.waiting ?? '·'}</strong>
          <span>Waiting on them</span>
        </button>
        <button type="button" className="ch-stat" onClick={() => setView('low')}>
          <strong>{counts?.low ?? '·'}</strong>
          <span>Low priority</span>
        </button>
      </div>

      <div className="ch-toolbar">
        <Chips
          label="Chat views"
          value={view}
          onChange={setView}
          options={VIEWS.map((v) => ({
            ...v,
            count: v.id === 'needs' ? (counts?.needs ?? undefined) : undefined,
          }))}
        />
        <div className="ch-tools">
          <label className="ch-search">
            <Search size={16} aria-hidden="true" />
            <span className="wf-sr">Search chats</span>
            <input
              type="search"
              value={search}
              maxLength={100}
              placeholder="Search chats"
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label className="ch-select">
            <span className="wf-sr">App</span>
            <select value={app} onChange={(e) => setApp(e.target.value as AppId | '')}>
              <option value="">All apps</option>
              {APPS.map((a) => (
                <option key={a} value={a}>
                  {APP_LABELS[a]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="button secondary"
            disabled={refreshing}
            onClick={() => void refresh()}
            aria-label="Refresh chats"
          >
            <RefreshCw size={16} aria-hidden="true" className={refreshing ? 'ch-spin' : ''} />
            <span className="ch-hide-narrow">Refresh</span>
          </button>
        </div>
      </div>
      {counts && counts.pending > 0 && (
        <p className="ch-note" aria-live="polite">
          {plural(counts.pending, 'chat')} being triaged.
        </p>
      )}

      {phase === 'loading' && <p className="ch-note">Loading chats…</p>}
      {phase === 'error' && (
        <div className="ch-card ch-banner warn" role="alert">
          <TriangleAlert size={22} aria-hidden="true" />
          <div>
            <strong>Chats could not be loaded</strong>
            <p>{error}</p>
          </div>
          <button type="button" className="button secondary" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}
      {phase === 'ready' && threads.length === 0 && (
        <Empty icon={MessagesSquare} title={EMPTY[view].title}>
          {EMPTY[view].body}
        </Empty>
      )}
      {phase === 'ready' && threads.length > 0 && (
        <ul className="ch-list" aria-label="Chats">
          {threads.map((t) => (
            <li key={t.id}>
              <ThreadRow thread={t} onOpen={() => setOpen(t.id)} />
            </li>
          ))}
        </ul>
      )}

      {open && (
        <ThreadDrawer
          threadId={open}
          onClose={() => setOpen(null)}
          onChanged={() => void load(true)}
          notify={notify}
          navigate={navigate}
        />
      )}
    </div>
  );
}

function ThreadRow({ thread: t, onOpen }: { thread: ChatThread; onOpen: () => void }) {
  const tier = t.triage?.tier ?? 3;
  const text = t.triage?.summary || t.lastIn?.text || '';
  const at = t.lastIn?.at ?? t.lastOutAt ?? t.updatedAt;
  return (
    <button
      type="button"
      className={'ch-row' + (t.needsMe ? ' needs' : '') + ` tier${tier}`}
      onClick={onOpen}
    >
      <span className={'ch-avatar app-' + t.app} aria-hidden="true">
        {initials(t)}
      </span>
      <span className="ch-row-main">
        <span className="ch-row-top">
          <strong className="ch-title">{t.title}</strong>
          {t.vip && <Star size={14} className="ch-vip" aria-label="VIP" />}
          <span className="ch-when">{whenLabel(at)}</span>
        </span>
        <span className="ch-row-meta">
          <span className={'ch-app app-' + t.app}>{APP_LABELS[t.app]}</span>
          {t.group && <span className="ch-tag">Group</span>}
          {t.triage && t.triage.status !== 'pending' && t.needsMe && (
            <span className={'ch-tier t' + tier}>{TIER_LABELS[tier]}</span>
          )}
          {t.triage?.status === 'pending' && <span className="ch-tag">Triaging</span>}
          {t.needsMe && t.waitingSince != null && (
            <span className="ch-wait">
              <BellRing size={12} aria-hidden="true" /> {waitedLabel(t.waitingSince)}
              {t.unanswered > 1 ? `, ${t.unanswered} messages` : ''}
            </span>
          )}
          {t.neverAi && <span className="ch-tag">Kept from AI</span>}
        </span>
        <span className="ch-text">{text}</span>
      </span>
    </button>
  );
}
