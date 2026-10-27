// Typed browser helper for agents actions.
import { callModule } from '../../../core/client/api';
import type { AgentsAction, AgentsActions } from './contract';

export function agents<A extends AgentsAction>(action: A, payload: AgentsActions[A]['payload']) {
  return callModule<AgentsActions[A]['result']>('agents', action, payload as object);
}
