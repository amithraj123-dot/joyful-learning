// Mail's services for other modules (the assistant). Each works on the caller's own mailbox and
// reads only stored triage (no Graph call), except draftReplyFor, which drafts with the AI.
// SIGNATURES ARE FIXED.
import type { ModuleContext } from '../../../core/server/module.ts';
import type { Draft, MailItem, MailView, QueueCounts } from '../shared/types.ts';
import { VIEWS } from '../shared/types.ts';
import { createDraft } from './drafts.ts';
import { listItems, loadAccount, queueCounts } from './store.ts';

const memberEmail = (ctx: ModuleContext) => ctx.member?.email ?? '';
const bound = (n: number, max: number) =>
  Number.isInteger(n) && n > 0 ? Math.min(n, max) : Math.min(10, max);

// Whether the caller has a connected Outlook account.
export async function mailConnected(ctx: ModuleContext): Promise<boolean> {
  const email = memberEmail(ctx);
  if (!email) return false;
  return (await loadAccount(ctx.db, email))?.status === 'connected';
}
// Queue counts, or null when no mailbox is connected.
export async function mailCounts(ctx: ModuleContext): Promise<QueueCounts | null> {
  const email = memberEmail(ctx);
  if (!email || !(await loadAccount(ctx.db, email))) return null;
  return queueCounts(ctx.db, email);
}
// Triaged mail in a view, newest first (urgent first within needs_me).
export async function mailQueue(ctx: ModuleContext, view: MailView, limit = 10): Promise<MailItem[]> {
  const email = memberEmail(ctx);
  if (!email || !(VIEWS as readonly string[]).includes(view)) return [];
  return listItems(ctx.db, email, { view, limit: bound(limit, 50), urgentFirst: view === 'needs_me' });
}
// Mail whose subject, sender or triage summary matches every word of the query.
export async function searchMail(ctx: ModuleContext, query: string, limit = 8): Promise<MailItem[]> {
  const email = memberEmail(ctx);
  const q = typeof query === 'string' ? query.trim().slice(0, 200) : '';
  if (!email || !q) return [];
  return listItems(ctx.db, email, { view: 'all', search: q, limit: bound(limit, 30) });
}
// Drafts a reply to one of the caller's emails (records "wanted" as the draft decision). Never sends.
export async function draftReplyFor(
  ctx: ModuleContext,
  mailId: string,
  instructions?: string,
): Promise<Draft> {
  return createDraft(ctx, mailId, instructions);
}
