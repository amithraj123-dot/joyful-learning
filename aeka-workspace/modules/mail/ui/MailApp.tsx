'use client';
// Mail module view: renders the selected Mail page inside the shared mail state.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModuleViewProps } from '../../../core/client/module';
import { ConnectPage, takeReturnNotice, type ReturnNotice } from './ConnectPage';
import { DraftsPage } from './DraftsPage';
import { InboxPage } from './InboxPage';
import { RulesPage } from './RulesPage';
import { MailProvider } from './store';
import '../../workflow/ui/workflow.css';
import './mail.css';

function Body({
  page,
  notice,
  onDismiss,
}: {
  page: string;
  notice: ReturnNotice | null;
  onDismiss: () => void;
}) {
  switch (page) {
    case 'mail/drafts':
      return <DraftsPage />;
    case 'mail/rules':
      return <RulesPage />;
    case 'mail/connect':
      return <ConnectPage notice={notice} onDismiss={onDismiss} />;
    default:
      return <InboxPage />;
  }
}

export default function MailApp({ page, navigate, notify }: ModuleViewProps) {
  // The shell passes new functions on each render; keep stable wrappers.
  const nav = useRef(navigate);
  const note = useRef(notify);
  useEffect(() => {
    nav.current = navigate;
    note.current = notify;
  });
  const stableNavigate = useCallback((p: string) => nav.current(p), []);
  const stableNotify = useCallback((m: string) => note.current(m), []);

  // Returning from Microsoft sign-in: shown on the connection page, or as a toast elsewhere.
  const [notice, setNotice] = useState<ReturnNotice | null>(null);
  useEffect(() => {
    const n = takeReturnNotice();
    if (!n) return;
    if (page === 'mail/connect') setNotice(n);
    else stableNotify(n.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <MailProvider navigate={stableNavigate} notify={stableNotify}>
      <div className="wf mail">
        <Body page={page} notice={notice} onDismiss={() => setNotice(null)} />
      </div>
    </MailProvider>
  );
}
