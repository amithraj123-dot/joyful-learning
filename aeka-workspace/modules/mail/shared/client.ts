// Typed browser helper for mail actions.
import { callModule } from '../../../core/client/api';
import type { MailAction, MailActions } from './contract';

export function mail<A extends MailAction>(action: A, payload: MailActions[A]['payload']) {
  return callModule<MailActions[A]['result']>('mail', action, payload as object);
}
