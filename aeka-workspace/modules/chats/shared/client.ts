// Typed browser helper for chats actions.
import { callModule } from '../../../core/client/api';
import type { ChatsAction, ChatsActions } from './contract';

export function chats<A extends ChatsAction>(action: A, payload: ChatsActions[A]['payload']) {
  return callModule<ChatsActions[A]['result']>('chats', action, payload as object);
}
