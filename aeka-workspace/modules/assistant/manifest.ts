// Assistant: a personal assistant with chat, to-dos, reminders, memory, a morning brief and WhatsApp.
// Web only; loaded lazily.
import { lazy } from 'react';
import { Bell, Brain, ListTodo, MessageSquareText, Settings, Sun } from 'lucide-react';
import type { ClientModule } from '../../core/client/module';

export const assistantModule: ClientModule = {
  id: 'assistant',
  name: 'Assistant',
  surfaces: ['web'],
  View: lazy(() => import('./ui/AssistantApp')),
  pages: [
    {
      id: 'assistant/today',
      label: 'Today',
      icon: Sun,
      title: 'Today',
      subtitle: 'Your brief: urgent mail, tasks, deadlines and reminders',
    },
    {
      id: 'assistant/chat',
      label: 'Ask Aeka',
      icon: MessageSquareText,
      title: 'Ask Aeka',
      subtitle: 'Ask in plain words; reminders, to-dos and drafts are made for your review',
    },
    {
      id: 'assistant/todos',
      label: 'To-dos and reminders',
      icon: ListTodo,
      title: 'To-dos and Reminders',
      subtitle: 'Personal to-dos and reminders, one-time or recurring',
    },
    {
      id: 'assistant/notifications',
      label: 'Notifications',
      icon: Bell,
      title: 'Notifications',
      subtitle: 'Reminders, briefs and alerts from every part of the workspace',
    },
    {
      id: 'assistant/memory',
      label: 'Memory',
      icon: Brain,
      title: 'Memory',
      subtitle: 'What you have asked the assistant to remember, including your writing style',
    },
    {
      id: 'assistant/settings',
      label: 'Assistant settings',
      icon: Settings,
      title: 'Assistant Settings',
      subtitle: 'Morning brief, WhatsApp and, for administrators, integrations',
    },
  ],
};
