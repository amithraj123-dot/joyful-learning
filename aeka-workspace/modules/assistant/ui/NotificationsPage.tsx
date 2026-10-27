'use client';
// Notifications from every module: opening one marks it read; all can be marked read at once.
import { useState } from 'react';
import { Bell, CheckCheck, ChevronRight } from 'lucide-react';
import { Chips, Empty } from '../../workflow/ui/components/Bits';
import { useAssistant, useTickChange } from './context';
import { InlineError, LoadError, Loading } from './Bits';
import { core, errorMessage, formatAgo, MODULE_LABELS, pageFor, useLoad, type Notice } from './lib';

type View = 'all' | 'unread';

export function NotificationsPage() {
  const { open, notify } = useAssistant();
  const list = useLoad(() => core<{ items: Notice[]; unread: number }>('notifications.list', { limit: 100 }));
  const [view, setView] = useState<View>('all');
  const [busy, setBusy] = useState(false);
  useTickChange(list.reload);

  const markRead = (ids: string[]) =>
    list.set((d) => ({
      unread: Math.max(0, d.unread - d.items.filter((n) => ids.includes(n.id) && !n.readAt).length),
      items: d.items.map((n) => (ids.includes(n.id) && !n.readAt ? { ...n, readAt: Date.now() } : n)),
    }));
  const openNotice = (n: Notice) => {
    if (!n.readAt) {
      markRead([n.id]);
      void core('notifications.read', { ids: [n.id] }).catch(() => undefined);
    }
    if (n.link && pageFor(n.link)) open(n.link);
  };
  const readAll = async () => {
    setBusy(true);
    try {
      await core('notifications.read', { ids: 'all' });
      list.set((d) => ({
        unread: 0,
        items: d.items.map((n) => (n.readAt ? n : { ...n, readAt: Date.now() })),
      }));
      notify('All notifications marked read');
    } catch (e) {
      notify(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (list.phase === 'loading') return <Loading>Loading notifications</Loading>;
  if (list.phase === 'error' || !list.data)
    return (
      <LoadError
        title="Notifications could not be loaded"
        message={list.error}
        status={list.status}
        onRetry={list.retry}
      />
    );
  const { items, unread } = list.data;
  const shown = view === 'unread' ? items.filter((n) => !n.readAt) : items;
  return (
    <div className="as-stack">
      <div className="as-toolbar">
        <Chips<View>
          label="Show"
          value={view}
          onChange={setView}
          options={[
            { id: 'all', label: 'All' },
            { id: 'unread', label: 'Unread', count: unread },
          ]}
        />
        <button type="button" className="button secondary" disabled={busy || unread === 0} onClick={readAll}>
          <CheckCheck size={15} aria-hidden="true" /> Mark all read
        </button>
      </div>
      <InlineError message={list.error} onRetry={list.retry} />
      {shown.length === 0 ? (
        <Empty icon={Bell} title={view === 'unread' ? 'Nothing unread' : 'No notifications yet'}>
          Reminders, your morning brief and urgent mail alerts appear here.
        </Empty>
      ) : (
        <ul className="as-notices">
          {shown.map((n) => {
            const linked = !!(n.link && pageFor(n.link));
            return (
              <li key={n.id}>
                <button
                  type="button"
                  className={'as-notice' + (n.readAt ? '' : ' unread')}
                  onClick={() => openNotice(n)}
                >
                  <span className="as-notice-dot" aria-hidden="true" />
                  {!n.readAt && <span className="wf-sr">Unread.</span>}
                  <span className="as-notice-main">
                    <span className="as-notice-meta">
                      <span className="as-tag">{MODULE_LABELS[n.module] ?? n.module}</span>
                      <time dateTime={new Date(n.createdAt).toISOString()}>{formatAgo(n.createdAt)}</time>
                    </span>
                    <strong>{n.title}</strong>
                    {n.body && <span className="as-notice-body">{n.body}</span>}
                  </span>
                  {linked && <ChevronRight size={16} aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
