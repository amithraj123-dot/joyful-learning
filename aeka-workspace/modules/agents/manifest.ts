// Agents: automations the member describes in plain words, run on command, on a schedule or when
// something happens, asking before anything leaves the workspace, and learning from feedback.
// Web only; loaded lazily.
import { lazy } from 'react';
import { Bot, Brain, LayoutTemplate } from 'lucide-react';
import type { ClientModule } from '../../core/client/module';

export const agentsModule: ClientModule = {
  id: 'agents',
  name: 'Agents',
  surfaces: ['web'],
  View: lazy(() => import('./ui/AgentsApp')),
  pages: [
    {
      id: 'agents/home',
      label: 'Agents',
      icon: Bot,
      title: 'Agents',
      subtitle: 'Automations you describe in plain words',
    },
    {
      id: 'agents/learning',
      label: 'Memory and learning',
      icon: Brain,
      title: 'Memory and Learning',
      subtitle: 'What your agents have learnt, and how to correct it',
    },
    {
      id: 'agents/templates',
      label: 'Templates',
      icon: LayoutTemplate,
      title: 'Firm Templates',
      subtitle: 'Starter agents by Aeka, and agents partners publish for the firm',
    },
  ],
};
