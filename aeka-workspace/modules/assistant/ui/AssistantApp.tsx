'use client';
// Assistant module view: the signed-in member, the background tick and the selected page.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ModuleViewProps } from '../../../core/client/module';
import { handOver } from '../../../core/client/handover';
import { Ctx, type AssistantCtx } from './context';
import { core, pageFor, type MeInfo } from './lib';
import { TodayPage } from './TodayPage';
import { ChatPage } from './ChatPage';
import { TodosPage } from './TodosPage';
import { NotificationsPage } from './NotificationsPage';
import { MemoryPage } from './MemoryPage';
import { SettingsPage } from './SettingsPage';
import '../../workflow/ui/workflow.css';
import './assistant.css';

const TICK_MS = 60_000;
// A tick younger than this is reused when a page asks for one (for example on opening Today).
const FRESH_MS = 20_000;

function Page({ page }: { page: string }) {
  switch (page) {
    case 'assistant/chat':
      return <ChatPage />;
    case 'assistant/todos':
      return <TodosPage />;
    case 'assistant/notifications':
      return <NotificationsPage />;
    case 'assistant/memory':
      return <MemoryPage />;
    case 'assistant/settings':
      return <SettingsPage />;
    default:
      return <TodayPage />;
  }
}

export default function AssistantApp({ page, navigate, notify }: ModuleViewProps) {
  // The shell passes new functions on each render; keep stable wrappers.
  const shell = useRef({ navigate, notify });
  useEffect(() => {
    shell.current = { navigate, notify };
  });
  const [me, setMe] = useState<MeInfo | null>(null);
  const [tickCount, setTickCount] = useState(0);
  const inFlight = useRef<Promise<void> | null>(null);
  const lastTick = useRef(0);

  const tick = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    if (Date.now() - lastTick.current < FRESH_MS) return Promise.resolve();
    const p = core('tick')
      .catch(() => undefined)
      .then(() => {
        lastTick.current = Date.now();
        inFlight.current = null;
        setTickCount((n) => n + 1);
      });
    inFlight.current = p;
    return p;
  }, []);

  useEffect(() => {
    core<MeInfo>('me').then(setMe, () => undefined);
    void tick();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void tick();
    }, TICK_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastTick.current > TICK_MS) void tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [tick]);

  const open = useCallback((link: string) => {
    const target = pageFor(link);
    if (!target) return;
    const ref = link.includes('#') ? link.slice(link.indexOf('#') + 1) : '';
    if (ref && target === 'workflow/matters') handOver('workflow.matter', { matterId: ref });
    if (ref && (target === 'notes' || target === 'meetings')) handOver('scribe.note', { noteId: ref });
    shell.current.navigate(target);
  }, []);

  const value = useMemo<AssistantCtx>(
    () => ({
      me,
      notify: (m) => shell.current.notify(m),
      navigate: (p) => shell.current.navigate(p),
      open,
      tick,
      tickCount,
    }),
    [me, open, tick, tickCount],
  );

  return (
    <Ctx.Provider value={value}>
      <div className="wf as">
        <Page page={page} />
      </div>
    </Ctx.Provider>
  );
}
