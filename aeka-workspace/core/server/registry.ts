// Server-side module registry. Add a module's server definition here to expose its actions on
// POST /api/modules. (The browser-side registry is core/client/registry.ts.)
import { assistantServer } from '../../modules/assistant/server/index.ts';
import { chatsServer } from '../../modules/chats/server/index.ts';
import { mailServer } from '../../modules/mail/server/index.ts';
import { workflowServer } from '../../modules/workflow/server/index.ts';
import { coreModule } from './core-module.ts';
import type { ServerModule } from './module.ts';

export const serverModules: ServerModule[] = [
  coreModule,
  workflowServer,
  mailServer,
  chatsServer,
  assistantServer,
];
