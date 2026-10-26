// Mail: Outlook inbox triage, drafts on request, reviewed sending and rules learned from corrections.
// Web only; loaded lazily.
import { lazy } from 'react';
import { Inbox, PencilLine, Plug, SlidersHorizontal } from 'lucide-react';
import type { ClientModule } from '../../core/client/module';

export const mailModule: ClientModule = {
  id: 'mail',
  name: 'Mail',
  surfaces: ['web'],
  View: lazy(() => import('./ui/MailApp')),
  pages: [
    {
      id: 'mail/inbox',
      label: 'Inbox triage',
      icon: Inbox,
      title: 'Inbox Triage',
      subtitle: 'What needs you, what can wait and what can go to the team',
    },
    {
      id: 'mail/drafts',
      label: 'Drafts',
      icon: PencilLine,
      title: 'Drafts',
      subtitle: 'Replies prepared on your request, to review, edit and send',
    },
    {
      id: 'mail/rules',
      label: 'Rules and learning',
      icon: SlidersHorizontal,
      title: 'Rules and Learning',
      subtitle: 'How your corrections shape triage, and the rules you have approved',
    },
    {
      id: 'mail/connect',
      label: 'Outlook connection',
      icon: Plug,
      title: 'Outlook Connection',
      subtitle: 'Connect your mailbox and choose what is sent to AI',
    },
  ],
};
