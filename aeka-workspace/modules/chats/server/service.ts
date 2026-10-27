// What other modules may read from Chats: the chats waiting for my reply (for the brief, Today and the
// assistant's chat). Only the caller's own chats; nothing when the member has no phone connected.
import type { ModuleContext } from '../../../core/server/module.ts';
import { APP_LABELS, type ChatThread } from '../shared/types.ts';
import { listThreads, loadSettings, queueCounts, waitLabel } from './store.ts';

export interface ChatNeedingMe {
  id: string;
  title: string;
  app: string; // e.g. "WhatsApp"
  tier: number;
  summary: string; // what they want, or the last message
  waitingFor: string; // e.g. "3 hours"
  waitingSince: number | null;
  vip: boolean;
  keptFromAi: boolean; // the member keeps this chat from AI: never pass its text to a model
  link: string; // page link, e.g. "chats/inbox#<id>"
}

// A chat kept from AI (or every chat, with AI switched off for chats) is listed without its text, because
// the brief and the assistant's answers can be passed to a model.
const brief = (t: ChatThread, now: number, kept: boolean): ChatNeedingMe => ({
  id: t.id,
  title: t.title,
  app: APP_LABELS[t.app],
  tier: t.triage?.tier ?? 3,
  summary: kept ? '' : t.triage?.summary || t.lastIn?.text.slice(0, 140) || '',
  waitingFor: t.waitingSince != null ? waitLabel(now - t.waitingSince) : '',
  waitingSince: t.waitingSince,
  vip: t.vip,
  keptFromAi: kept,
  link: `chats/inbox#${t.id}`,
});

export async function chatsNeedingMe(ctx: ModuleContext, limit = 10) {
  const email = ctx.member?.email;
  if (!email) return { total: 0, chats: [] as ChatNeedingMe[] };
  const threads = await listThreads(ctx.db, email, ctx.now, {
    view: 'needs',
    limit: Math.min(Math.max(limit, 1), 50),
  });
  const counts = await queueCounts(ctx.db, email, ctx.now);
  const { ai } = await loadSettings(ctx.db, email);
  return { total: counts.needs, chats: threads.map((t) => brief(t, ctx.now, t.neverAi || !ai)) };
}
