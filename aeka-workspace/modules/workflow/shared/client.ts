// Typed browser helper for workflow actions.
import { callModule } from '../../../core/client/api';
import type { WorkflowAction, WorkflowActions } from './contract';

export function wf<A extends WorkflowAction>(action: A, payload: WorkflowActions[A]['payload']) {
  return callModule<WorkflowActions[A]['result']>('workflow', action, payload as object);
}
