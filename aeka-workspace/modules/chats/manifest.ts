// Chats: WhatsApp, LinkedIn, Gmail, SMS, Teams and Slack messages read from the member's phone by the
// Aeka Android app, triaged like email, with nudges and drafts on request. Web only; loaded lazily.
import { lazy } from 'react';
import { MessagesSquare, Smartphone } from 'lucide-react';
import type { ClientModule } from '../../core/client/module';

export const chatsModule: ClientModule = {
  id: 'chats',
  name: 'Chats',
  surfaces: ['web'],
  View: lazy(() => import('./ui/ChatsApp')),
  pages: [
    {
      id: 'chats/inbox',
      label: 'Chats',
      icon: MessagesSquare,
      title: 'Chats',
      subtitle: 'WhatsApp, LinkedIn, SMS, Teams and Slack messages waiting for your reply',
    },
    {
      id: 'chats/phone',
      label: 'Phone app',
      icon: Smartphone,
      title: 'Phone App',
      subtitle: 'Connect your Android phone and choose what it reads',
    },
  ],
};
