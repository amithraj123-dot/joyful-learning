// Workflow server module: the actions of shared/contract.ts (tests check the two match).
import type { ServerModule } from '../../../core/server/module.ts';
import { billingActions } from './billing.ts';
import { dealActions } from './deals.ts';
import { exportAction } from './export.ts';
import { feedbackActions } from './feedback.ts';
import { importActions } from './import.ts';
import { matterActions } from './matters.ts';
import { snapshotActions } from './snapshot.ts';
import { taskActions } from './tasks.ts';
import { timeActions } from './time.ts';

export const workflowServer: ServerModule = {
  id: 'workflow',
  actions: {
    ...snapshotActions,
    ...matterActions,
    ...taskActions,
    ...timeActions,
    'time.export': exportAction,
    ...billingActions,
    ...dealActions,
    ...feedbackActions,
    ...importActions,
  },
};
