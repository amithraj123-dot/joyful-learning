// Server-side module registry. Add a module's server definition here to expose its actions on
// POST /api/modules. (The browser-side registry is core/client/registry.ts.)
import { workflowServer } from '../../modules/workflow/server/index.ts';
import { coreModule } from './core-module.ts';
import type { ServerModule } from './module.ts';

export const serverModules: ServerModule[] = [coreModule, workflowServer];
