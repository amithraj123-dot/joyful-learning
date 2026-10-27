// Chats server module: the actions of shared/contract.ts (tests check the two match). Every action works
// on the caller's own chats; rows are always read by the caller's email, so another member's chats are
// simply not found, administrators included.
import { CloudError } from '../../../lib/cloud-store.ts';
import { aiStatus } from '../../../core/server/ai.ts';
import type { Member } from '../../../core/server/members.ts';
import type { ModuleAction, ModuleContext, ServerModule } from '../../../core/server/module.ts';
import { releaseLease, takeLease } from '../../../core/server/notifications.ts';
import { addTodoFrom } from '../../assistant/server/services.ts';
import {
  ALERT_LABELS,
  ALERTS,
  APP_LABELS,
  APPS,
  VIEWS,
  type ChatSettings,
  type ChatView,
} from '../shared/types.ts';
import { newPairingCode } from './device.ts';
import { createDraft, discardDraft, markSent, prepareSend, updateDraft } from './drafts.ts';
import { runNudges } from './nudges.ts';
import {
  baseRevision,
  bad,
  conflict,
  getThread,
  HOUR,
  idOf,
  isApp,
  isCategory,
  isReplyNeeded,
  isTier,
  KEEP_MS,
  listDevices,
  listThreads,
  loadSettings,
  loadThread,
  memberOf,
  openDraft,
  queueCounts,
  saveSettings,
  threadFrom,
  threadMessages,
  type Row,
  type Sys,
} from './store.ts';
import { runChatTriage } from './triage.ts';

const reload = async (ctx: ModuleContext, member: string, id: string) =>
  threadFrom((await loadThread(ctx.db, member, id))!, ctx.now);

const threadActions: Record<string, ModuleAction> = {
  'threads.list': {
    handler: async (ctx, p) => {
      const member = memberOf(ctx);
      if (!(VIEWS as readonly unknown[]).includes(p.view)) throw bad('Choose a valid view.');
      if (p.app != null && !isApp(p.app)) throw bad('Choose a valid app.');
      if (p.search != null && (typeof p.search !== 'string' || p.search.length > 100))
        throw bad('Keep the search to 100 characters or fewer.');
      const limit = typeof p.limit === 'number' && Number.isInteger(p.limit) ? p.limit : 50;
      const threads = await listThreads(ctx.db, member, ctx.now, {
        view: p.view as ChatView,
        app: isApp(p.app) ? p.app : undefined,
        search: typeof p.search === 'string' ? p.search.trim() : undefined,
        limit,
      });
      return { threads, counts: await queueCounts(ctx.db, member, ctx.now) };
    },
  },
  'thread.get': {
    handler: async (ctx, p) => {
      const { member, thread } = await getThread(ctx, p.id);
      return {
        thread,
        messages: await threadMessages(ctx.db, member, thread.id),
        draft: await openDraft(ctx.db, member, thread.id),
      };
    },
  },
  'thread.update': {
    handler: async (ctx, p) => {
      const { member, thread } = await getThread(ctx, p.id);
      const set: Record<string, unknown> = {};
      switch (p.op) {
        case 'done':
          set.done_at = ctx.now;
          break;
        case 'reopen':
          set.done_at = null;
          set.snoozed_until = null;
          break;
        case 'replied':
          set.last_out_at = Math.max(ctx.now, thread.lastIn?.at ?? 0);
          set.waiting_since = null;
          set.unanswered = 0;
          set.nudge_level = 0;
          break;
        case 'snooze': {
          const h = p.hours;
          if (typeof h !== 'number' || !Number.isInteger(h) || h < 1 || h > 168)
            throw bad('Snooze for 1 to 168 hours.');
          set.snoozed_until = ctx.now + h * HOUR;
          break;
        }
        case 'mute':
          set.muted = 1;
          break;
        case 'unmute':
          set.muted = 0;
          // Messages that arrived while muted are triaged now.
          if (
            thread.lastIn &&
            (!thread.triage || thread.triage.status === 'skipped' || thread.triage.status === 'none')
          )
            Object.assign(set, { triage_status: 'pending', next_attempt_at: 0, attempts: 0 });
          break;
        case 'neverAi':
          set.never_ai = 1;
          // Re-triage by rules so nothing the AI said stays on a chat now kept from it.
          if (thread.lastIn)
            Object.assign(set, { triage_status: 'pending', next_attempt_at: 0, attempts: 0 });
          break;
        case 'allowAi':
          set.never_ai = 0;
          if (thread.lastIn)
            Object.assign(set, { triage_status: 'pending', next_attempt_at: 0, attempts: 0 });
          break;
        case 'vip':
          set.vip = 1;
          break;
        case 'unvip':
          set.vip = 0;
          break;
        default:
          throw bad('Choose a valid change.');
      }
      if (p.op === 'neverAi') Object.assign(set, { summary: '', why: '', model: '' });
      const cols = Object.keys(set);
      await ctx.db
        .prepare(
          `UPDATE ch_threads SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ?, revision = revision + 1 WHERE member = ? AND id = ?`,
        )
        .bind(...cols.map((c) => set[c]), ctx.now, member, thread.id)
        .run();
      if (p.op === 'neverAi' || p.op === 'allowAi' || p.op === 'unmute')
        await runChatTriage(ctx, ctx.member!);
      return reload(ctx, member, thread.id);
    },
  },
  'thread.correct': {
    handler: async (ctx, p) => {
      const { member, row, thread } = await getThread(ctx, p.id);
      const tier = p.tier ?? row.tier;
      const replyNeeded = p.replyNeeded ?? row.reply_needed;
      const category = p.category ?? row.category;
      if (!isTier(tier) || !isReplyNeeded(replyNeeded) || !isCategory(category))
        throw bad('Choose valid values.');
      const r = await ctx.db
        .prepare(
          `UPDATE ch_threads SET tier = ?, reply_needed = ?, category = ?, triage_source = 'manual', triage_status = 'done',
             why = 'Set by you.', triaged_upto = coalesce(last_in_at, 0), attempts = 0, next_attempt_at = 0, updated_at = ?, revision = revision + 1
           WHERE member = ? AND id = ? AND revision = ?`,
        )
        .bind(tier, replyNeeded, category, ctx.now, member, thread.id, baseRevision(p))
        .run();
      if (!r.meta.changes) throw conflict('chat');
      return reload(ctx, member, thread.id);
    },
  },
  'thread.retriage': {
    handler: async (ctx, p) => {
      const { member, thread } = await getThread(ctx, p.id);
      if (thread.muted) throw new CloudError('Unmute this chat first.', 409);
      if (!thread.lastIn) throw new CloudError('There is nothing to triage in this chat yet.', 409);
      await ctx.db
        .prepare(
          "UPDATE ch_threads SET triage_status = 'pending', triage_source = 'rules', attempts = 0, next_attempt_at = 0, updated_at = ?, revision = revision + 1 WHERE member = ? AND id = ?",
        )
        .bind(ctx.now, member, thread.id)
        .run();
      await runChatTriage(ctx, ctx.member!);
      return reload(ctx, member, thread.id);
    },
  },
  'thread.toTodo': {
    handler: async (ctx, p) => {
      const { thread } = await getThread(ctx, p.id);
      if (!thread.lastIn) throw new CloudError('There is nothing in this chat to follow up yet.', 409);
      const app = APP_LABELS[thread.app];
      // To-dos can reach the assistant's model, so a chat kept from AI gives its name only.
      const kept = thread.neverAi || !(await loadSettings(ctx.db, memberOf(ctx))).ai;
      const what = kept ? '' : thread.triage?.summary || thread.lastIn.text;
      const todo = await addTodoFrom(ctx, {
        title: (what ? `Reply to ${thread.title}: ${what}` : `Reply to ${thread.title} (${app})`).slice(
          0,
          200,
        ),
        details: `${app} chat, last message ${new Date(thread.lastIn.at).toISOString().slice(0, 10)}.`,
        dueAt: thread.triage?.replyBy ? Date.parse(`${thread.triage.replyBy}T18:00:00+05:30`) : null,
        priority: thread.triage?.tier === 1 ? 'high' : 'normal',
        source: 'phone',
        sourceRef: `${thread.id}:${thread.waitingSince ?? thread.lastIn.at}`,
        sourceLabel: `${thread.title} (${app})`,
      });
      if (!todo) throw new CloudError('A to-do for this chat was already added.', 409);
      return { todoId: todo.id };
    },
  },
};

const draftActions: Record<string, ModuleAction> = {
  'draft.create': { handler: (ctx, p) => createDraft(ctx, p.threadId, p.instructions) },
  'draft.update': { handler: (ctx, p) => updateDraft(ctx, p) },
  'draft.discard': { handler: (ctx, p) => discardDraft(ctx, p) },
  'draft.prepareSend': { handler: (ctx, p) => prepareSend(ctx, p) },
  'draft.markSent': { handler: (ctx, p) => markSent(ctx, p) },
};

const settingsActions: Record<string, ModuleAction> = {
  run: {
    handler: async (ctx) => {
      const member = memberOf(ctx);
      const r = await runChatTriage(ctx, ctx.member!);
      return { triaged: r.triaged, pending: (await queueCounts(ctx.db, member, ctx.now)).pending };
    },
  },
  'settings.get': { handler: (ctx) => loadSettings(ctx.db, memberOf(ctx)) },
  'settings.update': {
    handler: async (ctx, p) => {
      const member = memberOf(ctx);
      const s = p.settings as Row;
      if (!s || typeof s !== 'object' || !s.apps || typeof s.apps !== 'object')
        throw bad('Send the settings.');
      const apps = s.apps as Row;
      const flag = (v: unknown, label: string) => {
        if (typeof v !== 'boolean') throw bad(`Choose yes or no for ${label}.`);
        return v;
      };
      // Kinds added later keep their current value when an older page leaves them out.
      const current = await loadSettings(ctx.db, member);
      const given = s.alerts && typeof s.alerts === 'object' ? (s.alerts as Row) : {};
      const settings: ChatSettings = {
        apps: Object.fromEntries(APPS.map((a) => [a, flag(apps[a], APP_LABELS[a])])) as ChatSettings['apps'],
        alerts: Object.fromEntries(
          ALERTS.map((a) => [
            a,
            given[a] === undefined ? current.alerts[a] : flag(given[a], ALERT_LABELS[a]),
          ]),
        ) as ChatSettings['alerts'],
        nudges: flag(s.nudges, 'nudges'),
        quietHours: flag(s.quietHours, 'quiet hours'),
        ai: flag(s.ai, 'AI triage'),
      };
      await saveSettings(ctx.db, member, settings, ctx.now);
      await ctx.log('settings.updated', member, 'Changed chat settings');
      return settings;
    },
  },
  'phone.status': {
    handler: async (ctx) => ({
      devices: await listDevices(ctx.db, memberOf(ctx)),
      aiReady: aiStatus(ctx.env).ready,
    }),
  },
  'phone.pairingCode': { handler: (ctx) => newPairingCode(ctx.db, memberOf(ctx), ctx.now) },
  'phone.revoke': {
    handler: async (ctx, p) => {
      const member = memberOf(ctx);
      const r = await ctx.db
        .prepare('UPDATE ch_devices SET revoked_at = ? WHERE member = ? AND id = ? AND revoked_at IS NULL')
        .bind(ctx.now, member, idOf(p.deviceId, 'phone'))
        .run();
      if (!r.meta.changes) throw new CloudError('This phone could not be found.', 404);
      await ctx.log('phone.revoked', member, 'Disconnected a phone');
      return true;
    },
  },
  'data.delete': {
    handler: async (ctx, p) => {
      if (p.confirm !== true) throw bad('Confirm that every chat should be deleted.');
      const member = memberOf(ctx);
      await deleteChatData(ctx.db, member);
      await ctx.log('data.deleted', member, 'Deleted chats read from the phone');
      return true;
    },
  },
};

export async function deleteChatData(db: D1Database, member: string) {
  await db.batch([
    db.prepare('DELETE FROM ch_messages WHERE member = ?').bind(member),
    db.prepare('DELETE FROM ch_drafts WHERE member = ?').bind(member),
    db.prepare('DELETE FROM ch_threads WHERE member = ?').bind(member),
  ]);
}

// Messages and finished drafts older than 30 days are deleted; chats idle that long lose their text.
async function housekeeping(sys: Sys, member: string) {
  if (!(await takeLease(sys.db, `chats-clean:${member}`, sys.now, 6 * HOUR))) return;
  const cutoff = sys.now - KEEP_MS;
  await sys.db.batch([
    sys.db.prepare('DELETE FROM ch_messages WHERE member = ? AND received_at < ?').bind(member, cutoff),
    sys.db
      .prepare("DELETE FROM ch_drafts WHERE member = ? AND status != 'draft' AND updated_at < ?")
      .bind(member, cutoff),
    sys.db
      .prepare(
        "UPDATE ch_threads SET last_in_text = '', summary = '', why = '' WHERE member = ? AND coalesce(last_in_at, last_out_at, created_at) < ? AND last_in_text != ''",
      )
      .bind(member, cutoff),
    sys.db
      .prepare(
        'DELETE FROM ch_threads WHERE member = ? AND coalesce(last_in_at, last_out_at, created_at) < ?',
      )
      .bind(member, sys.now - 3 * KEEP_MS),
  ]);
}

// Triage and nudges for one member. Called by the background tick and right after a phone sync.
export async function chatsPass(sys: Sys, member: Member) {
  const lease = `chats:${member.email}`;
  if (!(await takeLease(sys.db, lease, sys.now, 4 * 60000))) return null;
  try {
    const settings = await loadSettings(sys.db, member.email);
    const triage = await runChatTriage(sys, member, settings);
    const nudged = await runNudges(sys, member.email, settings);
    return { ...triage, nudged };
  } finally {
    await releaseLease(sys.db, lease);
  }
}

export const chatsServer: ServerModule = {
  id: 'chats',
  actions: { ...threadActions, ...draftActions, ...settingsActions },
  tick: async (sys, { member }) => {
    if (!member) return;
    // Nothing to do for a member who never connected a phone.
    const any = await sys.db
      .prepare('SELECT 1 FROM ch_threads WHERE member = ? LIMIT 1')
      .bind(member.email)
      .first();
    if (!any) return;
    await chatsPass(sys, member);
    await housekeeping(sys, member.email);
  },
};
