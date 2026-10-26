// Typed browser helper for assistant actions.
import { callModule } from '../../../core/client/api';
import type { AssistantAction, AssistantActions } from './contract';

export function assistant<A extends AssistantAction>(action: A, payload: AssistantActions[A]['payload']) {
  return callModule<AssistantActions[A]['result']>('assistant', action, payload as object);
}
