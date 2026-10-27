'use client';
// Chats module view: the chat list and the phone app page.
import { useCallback, useEffect, useRef } from 'react';
import type { ModuleViewProps } from '../../../core/client/module';
import { InboxPage } from './InboxPage';
import { PhonePage } from './PhonePage';
import '../../workflow/ui/workflow.css';
import './chats.css';

export default function ChatsApp({ page, navigate, notify }: ModuleViewProps) {
  // The shell passes new functions on each render; keep stable wrappers.
  const nav = useRef(navigate);
  const note = useRef(notify);
  useEffect(() => {
    nav.current = navigate;
    note.current = notify;
  });
  const stableNavigate = useCallback((p: string) => nav.current(p), []);
  const stableNotify = useCallback((m: string) => note.current(m), []);
  return (
    <div className="wf chats">
      {page === 'chats/phone' ? (
        <PhonePage notify={stableNotify} />
      ) : (
        <InboxPage navigate={stableNavigate} notify={stableNotify} />
      )}
    </div>
  );
}
