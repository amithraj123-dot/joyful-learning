// Mail's services for other modules (the assistant). Each works on the caller's own mailbox and
// reads only stored triage (no Graph call), except draftReplyFor, which drafts with the AI.
// SIGNATURES ARE FIXED; implementations are filled in by the mail server work.
import type { ModuleContext } from '../../../core/server/module.ts';
import type { Draft, MailItem, MailView, QueueCounts } from '../shared/types.ts';

const pending = (): never => {
  throw new Error('Mail service not implemented yet.');
};

// Whether the caller has a connected Outlook account.
export async function mailConnected(_ctx: ModuleContext): Promise<boolean> {
  return pending();
}
// Queue counts, or null when no mailbox is connected.
export async function mailCounts(_ctx: ModuleContext): Promise<QueueCounts | null> {
  return pending();
}
// Triaged mail in a view, newest first (urgent first within needs_me).
export async function mailQueue(_ctx: ModuleContext, _view: MailView, _limit = 10): Promise<MailItem[]> {
  return pending();
}
// Mail whose subject, sender or triage summary matches every word of the query.
export async function searchMail(_ctx: ModuleContext, _query: string, _limit = 8): Promise<MailItem[]> {
  return pending();
}
// Drafts a reply to one of the caller's emails (records "wanted" as the draft decision). Never sends.
export async function draftReplyFor(
  _ctx: ModuleContext,
  _mailId: string,
  _instructions?: string,
): Promise<Draft> {
  return pending();
}
