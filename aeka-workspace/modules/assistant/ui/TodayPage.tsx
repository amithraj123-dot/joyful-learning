'use client';
// Today: quick capture, the week at a glance, upcoming meetings with prep, the morning brief, unread
// notifications and a way into Ask Aeka.
import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Bell, ChevronRight, RefreshCw, Sun } from 'lucide-react';
import { assistant } from '../shared/client';
import { askLater, useAssistant, useTickChange } from './context';
import { Card, InlineError, LoadError, Loading } from './Bits';
import { QuickCapture } from './QuickCapture';
import { UpcomingMeetings, WeekStrip } from './Schedule';
import {
  core,
  firstName,
  formatAgo,
  formatClock,
  formatLongDay,
  greeting,
  MODULE_LABELS,
  todayIst,
  useLoad,
  type Notice,
} from './lib';

function Brief({ version }: { version: number }) {
  const { open, tick } = useAssistant();
  // Due reminders and mail are brought up to date by a tick first.
  const brief = useLoad(async () => {
    await tick();
    return assistant('brief.get', {});
  });
  const { reload } = brief;
  // Something was just captured: refresh quietly.
  useEffect(() => {
    if (version) void reload();
  }, [version, reload]);

  if (brief.phase === 'loading') return <Loading>Preparing your brief</Loading>;
  if (brief.phase === 'error' || !brief.data)
    return (
      <LoadError
        title="Your brief could not be loaded"
        message={brief.error}
        status={brief.status}
        onRetry={brief.retry}
      />
    );
  const { sections, generatedAt } = brief.data;
  const filled = sections.filter((s) => s.lines.length);
  return (
    <div className="as-brief" aria-live="polite">
      <div className="as-brief-meta">
        <span>Updated {formatClock(generatedAt)}</span>
        <button type="button" className="wf-link as-tap" onClick={() => void brief.reload()}>
          <RefreshCw size={13} aria-hidden="true" /> Refresh
        </button>
      </div>
      <InlineError message={brief.error} />
      {filled.length === 0 && (
        <div className="as-calm">
          <Sun size={22} aria-hidden="true" />
          <div>
            <strong>Nothing needs you right now.</strong>
            <p>No urgent mail, tasks due or reminders today. New items will appear here.</p>
          </div>
        </div>
      )}
      {filled.map((s, i) => (
        <Card key={s.title + i} title={s.title} count={s.lines.length} id={'as-brief-' + i}>
          <ul className="as-lines">
            {s.lines.map((l, j) => (
              <li key={j}>
                {l.link ? (
                  <button type="button" className="as-line link" onClick={() => open(l.link!)}>
                    <span>{l.text}</span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                ) : (
                  <span className="as-line">{l.text}</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

function Unread() {
  const { open, navigate } = useAssistant();
  const list = useLoad(() => core<{ items: Notice[]; unread: number }>('notifications.list', { limit: 30 }));
  // A tick may have posted new notices (for example a due reminder).
  useTickChange(list.reload);
  const items = (list.data?.items ?? []).filter((n) => !n.readAt).slice(0, 5);
  const openNotice = (n: Notice) => {
    void core('notifications.read', { ids: [n.id] }).catch(() => undefined);
    list.set((d) => ({
      unread: Math.max(0, d.unread - 1),
      items: d.items.map((x) => (x.id === n.id ? { ...x, readAt: Date.now() } : x)),
    }));
    if (n.link) open(n.link);
  };
  return (
    <Card
      title="Unread notifications"
      count={list.data?.unread}
      id="as-today-unread"
      action={
        <button type="button" className="wf-link as-tap" onClick={() => navigate('assistant/notifications')}>
          See all
        </button>
      }
    >
      {list.phase === 'loading' ? (
        <Loading>Loading notifications</Loading>
      ) : list.phase === 'error' ? (
        <InlineError message={list.error} onRetry={list.retry} />
      ) : items.length === 0 ? (
        <p className="as-quiet">
          <Bell size={15} aria-hidden="true" /> You are all caught up.
        </p>
      ) : (
        <ul className="as-lines">
          {items.map((n) => (
            <li key={n.id}>
              <button type="button" className="as-line link as-notice-line" onClick={() => openNotice(n)}>
                <span>
                  <strong>{n.title}</strong>
                  <small>
                    {MODULE_LABELS[n.module] ?? n.module} · {formatAgo(n.createdAt)}
                  </small>
                </span>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AskBox() {
  const { navigate } = useAssistant();
  const [text, setText] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) askLater(text.trim());
    navigate('assistant/chat');
  };
  return (
    <Card title="Ask Aeka" id="as-today-ask">
      <form className="as-ask" onSubmit={submit}>
        <label htmlFor="as-today-ask-input" className="wf-sr">
          Ask Aeka
        </label>
        <input
          id="as-today-ask-input"
          className="wf-input"
          value={text}
          maxLength={4000}
          placeholder="What needs me today?"
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
        />
        <button type="submit" className="button secondary">
          Ask <ArrowRight size={14} aria-hidden="true" />
        </button>
      </form>
      <p className="as-quiet small">
        Reminders, to-dos and drafts it makes are listed for your review. It never sends anything on its own.
      </p>
    </Card>
  );
}

export function TodayPage() {
  const { me } = useAssistant();
  const [captureKey, setCaptureKey] = useState(0);
  const name = firstName(me?.member?.name);
  return (
    <div className="as-today">
      <header className="as-greeting">
        <p className="wf-eyebrow">{formatLongDay(todayIst())}</p>
        <h2>
          {greeting()}
          {name ? ', ' + name : ''}
        </h2>
      </header>
      <div className="as-today-capture card as-card tinted">
        <QuickCapture onAdded={() => setCaptureKey((k) => k + 1)} />
      </div>
      <div className="as-today-week">
        <WeekStrip />
      </div>
      <div className="as-today-meet">
        <UpcomingMeetings />
      </div>
      <div className="as-today-brief">
        <Brief version={captureKey} />
      </div>
      <aside className="as-today-side">
        <Unread />
        <AskBox />
      </aside>
    </div>
  );
}
