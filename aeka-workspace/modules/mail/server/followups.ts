// Follow-ups from stored mail, per conversation, without AI.
//   waiting: my message is the latest in the conversation, sent 2 or more days ago, to at least one
//     address that is not mine and not an automated one; level 1 after 2 days, 2 after 5, 3 after 10.
//   chasing: someone wrote 2 or more times since I last wrote (or I never wrote); level = their count,
//     capped at 3.
// Done hides the follow-up only for the state it was marked in: a later message brings it back. A snooze
// hides the conversation until it ends. Replies sent from the workspace count as mine at once.
import { CloudError } from '../../../lib/cloud-store.ts';
import type { ModuleAction, ModuleContext } from '../../../core/server/module.ts';
import { matterTargets } from '../../workflow/server/services.ts';
import type { Address, Draft, FollowUp, FollowUpKind } from '../shared/types.ts';
import { createNudge } from './drafts.ts';
import { confirmedLink } from './rules.ts';
import { addresses, DAY, loadAccount, memberOf, notFound, type MessageRow } from './store.ts';
import { NO_REPLY } from './triage.ts';
import { text } from './validate.ts';

const WINDOW = 60 * DAY;
const MAX_CONVERSATIONS = 300;
const AUTOMATED_SUBJECT =
  /^\s*(accepted|declined|tentative|tentatively accepted|new time proposed|canceled|cancelled|automatic reply|auto[- ]?reply|out of (the )?office|read|delivered)\b[^:]{0,20}:/i;

type Row = Pick<
  MessageRow,
  | 'id'
  | 'conversation_id'
  | 'folder'
  | 'subject'
  | 'from_address'
  | 'from_name'
  | 'to_json'
  | 'cc_json'
  | 'received_at'
  | 'removed_at'
  | 'bulk'
>;
interface SentDraft {
  message_id: string;
  conversation_id: string;
  sent_at: number;
  to_json: string;
  cc_json: string;
}
interface ThreadState {
  conversation_id: string;
  waiting_snoozed_until: number | null;
  waiting_done: number;
  chasing_done: number;
  updated_at: number;
}
export type FollowUpRow = FollowUp & { done: boolean };

const automatedAddress = (a: string) => NO_REPLY.test(a.split('@')[0] || '');
const levelForAge = (ms: number): 0 | 1 | 2 | 3 =>
  ms >= 10 * DAY ? 3 : ms >= 5 * DAY ? 2 : ms >= 2 * DAY ? 1 : 0;

// The follow-ups of a set of conversations (pure, so the rules are easy to test). `link` gives a
// mandate label for an address. Includes hidden ones, marked by `done` and `snoozedUntil`.
export async function computeFollowUps(
  rows: Row[],
  drafts: SentDraft[],
  threads: Map<string, ThreadState>,
  me: Set<string>,
  now: number,
  link: (address: string) => Promise<string>,
): Promise<FollowUpRow[]> {
  const byConversation = new Map<string, Row[]>();
  for (const r of rows)
    if (r.conversation_id) {
      const list = byConversation.get(r.conversation_id) ?? [];
      list.push(r);
      byConversation.set(r.conversation_id, list);
    }
  const draftsBy = new Map<string, SentDraft[]>();
  for (const d of drafts) draftsBy.set(d.conversation_id, [...(draftsBy.get(d.conversation_id) ?? []), d]);

  const out: FollowUpRow[] = [];
  for (const [conversationId, list] of byConversation) {
    type Entry = { at: number; mine: boolean; row: Row | null; to: Address[]; cc: Address[] };
    const sent = list.filter((r) => r.folder === 'sent');
    const entries: Entry[] = [
      ...sent.map((r) => ({
        at: r.received_at,
        mine: true,
        row: r,
        to: addresses(r.to_json),
        cc: addresses(r.cc_json),
      })),
      // Inbox copies of my own mail are not replies.
      ...list
        .filter((r) => r.folder === 'inbox' && !me.has(r.from_address))
        .map((r) => ({ at: r.received_at, mine: false, row: r, to: [], cc: [] })),
      // A reply sent from the workspace, until Sent Items shows it.
      ...(draftsBy.get(conversationId) ?? [])
        .filter((d) => !sent.some((r) => r.received_at >= d.sent_at - 10 * 60000))
        .map((d) => ({
          at: d.sent_at,
          mine: true,
          row: null,
          to: addresses(d.to_json),
          cc: addresses(d.cc_json),
        })),
    ].sort((a, b) => a.at - b.at);
    if (!entries.length) continue;
    const state = threads.get(conversationId);
    const snoozed =
      state?.waiting_snoozed_until && state.waiting_snoozed_until > now ? state.waiting_snoozed_until : null;
    const subjectRow = list.reduce((a, b) => (b.received_at > a.received_at ? b : a));
    const subject = subjectRow.subject || '(no subject)';
    const last = entries[entries.length - 1];
    const lastMine = [...entries].reverse().find((e) => e.mine) ?? null;

    if (last.mine) {
      const others = [...last.to, ...last.cc].filter((a) => a.address && !me.has(a.address));
      const automated = AUTOMATED_SUBJECT.test(last.row?.subject ?? subject);
      const level = levelForAge(now - last.at);
      if (!level || automated || !others.some((a) => !automatedAddress(a.address))) continue;
      const counterpart =
        last.to.find((a) => a.address && !me.has(a.address)) ?? others.find((a) => a.address)!;
      let count = 0;
      for (let i = entries.length - 1; i >= 0 && entries[i].mine; i--) count++;
      const latestSent = sent.length ? sent.reduce((a, b) => (b.received_at > a.received_at ? b : a)) : null;
      const done = !!state?.waiting_done && state.updated_at >= last.at;
      out.push({
        conversationId,
        kind: 'waiting',
        subject,
        counterpart: { name: counterpart.name, address: counterpart.address },
        since: last.at,
        ageDays: Math.floor((now - last.at) / DAY),
        level,
        count,
        mailId: latestSent?.id ?? draftsBy.get(conversationId)![0].message_id,
        matterLabel: await link(counterpart.address),
        snoozedUntil: snoozed,
        done,
      });
      continue;
    }

    // Chasing: their latest unanswered message, and how often its sender wrote since I last wrote.
    const after = lastMine?.at ?? 0;
    const theirs = entries.filter((e) => !e.mine && e.at > after && e.row && !e.row.removed_at);
    const latest = theirs[theirs.length - 1];
    if (!latest?.row || latest.row.bulk === 1 || automatedAddress(latest.row.from_address)) continue;
    const sender = latest.row.from_address;
    const fromSender = theirs.filter((e) => e.row!.from_address === sender);
    if (fromSender.length < 2) continue;
    const done = !!state?.chasing_done && state.updated_at >= latest.at;
    out.push({
      conversationId,
      kind: 'chasing',
      subject,
      counterpart: { name: latest.row.from_name, address: sender },
      since: fromSender[0].at,
      ageDays: Math.floor((now - fromSender[0].at) / DAY),
      level: Math.min(fromSender.length, 3) as 2 | 3,
      count: fromSender.length,
      mailId: latest.row.id,
      matterLabel: await link(sender),
      snoozedUntil: snoozed,
      done,
    });
  }
  return out.sort((a, b) => b.level - a.level || a.since - b.since);
}

async function meOf(db: D1Database, member: string) {
  const account = await loadAccount(db, member);
  return new Set([member, account?.address || member].map((a) => a.toLowerCase()));
}

// The caller's follow-ups (hidden ones too when asked), most pressing first.
export async function listFollowUps(
  ctx: ModuleContext,
  o: { kind?: FollowUpKind; includeHidden?: boolean; conversationId?: string; limit?: number },
): Promise<FollowUpRow[]> {
  const member = memberOf(ctx);
  const since = ctx.now - WINDOW;
  const ids = o.conversationId
    ? [o.conversationId]
    : (
        await ctx.db
          .prepare(
            `SELECT conversation_id AS id FROM mail_messages WHERE member = ? AND conversation_id != '' AND received_at >= ?
             GROUP BY conversation_id HAVING sum(folder = 'sent') > 0 OR sum(folder = 'inbox') >= 2
             ORDER BY max(received_at) DESC LIMIT ?`,
          )
          .bind(member, since, MAX_CONVERSATIONS)
          .all<{ id: string }>()
      ).results.map((r) => r.id);
  if (!ids.length) return [];
  const rows: Row[] = [];
  const drafts: SentDraft[] = [];
  const threads = new Map<string, ThreadState>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const q = chunk.map(() => '?').join(',');
    rows.push(
      ...(
        await ctx.db
          .prepare(
            `SELECT id, conversation_id, folder, subject, from_address, from_name, to_json, cc_json, received_at,
             removed_at, bulk FROM mail_messages WHERE member = ? AND conversation_id IN (${q})`,
          )
          .bind(member, ...chunk)
          .all<Row>()
      ).results,
    );
    drafts.push(
      ...(
        await ctx.db
          .prepare(
            `SELECT d.message_id, m.conversation_id, d.sent_at, d.to_json, d.cc_json FROM mail_drafts d
             JOIN mail_messages m ON m.id = d.message_id AND m.member = d.member
             WHERE d.member = ? AND d.status = 'sent' AND d.sent_at IS NOT NULL AND m.conversation_id IN (${q})`,
          )
          .bind(member, ...chunk)
          .all<SentDraft>()
      ).results,
    );
    for (const t of (
      await ctx.db
        .prepare(`SELECT * FROM mail_threads WHERE member = ? AND conversation_id IN (${q})`)
        .bind(member, ...chunk)
        .all<ThreadState>()
    ).results)
      threads.set(t.conversation_id, t);
  }
  const targets = await matterTargets(ctx).catch(() => []);
  const labels = new Map(targets.map((t) => [t.matterId, `${t.clientName}: ${t.title}`]));
  const visible = new Set(labels.keys());
  const seen = new Map<string, string>();
  const link = async (address: string) => {
    if (!seen.has(address)) {
      const id = visible.size ? await confirmedLink(ctx.db, member, address, visible) : null;
      seen.set(address, id ? (labels.get(id) ?? '') : '');
    }
    return seen.get(address)!;
  };
  const all = await computeFollowUps(rows, drafts, threads, await meOf(ctx.db, member), ctx.now, link);
  return all
    .filter((f) => (!o.kind || f.kind === o.kind) && (o.includeHidden || (!f.done && !f.snoozedUntil)))
    .slice(0, o.limit ?? 200);
}

const KINDS = ['waiting', 'chasing'];
const conversationOf = (v: unknown) => {
  if (typeof v !== 'string' || !v || v.length > 500) throw notFound('conversation');
  return v;
};

export const followUpActions: Record<string, ModuleAction> = {
  'followups.list': {
    handler: async (ctx, p) => {
      if (p.kind != null && !KINDS.includes(p.kind as string)) throw new CloudError('Choose a valid kind.');
      if (p.includeHidden != null && typeof p.includeHidden !== 'boolean')
        throw new CloudError('Choose yes or no for showing done or snoozed follow-ups.');
      return listFollowUps(ctx, {
        kind: (p.kind as FollowUpKind | undefined) ?? undefined,
        includeHidden: p.includeHidden === true,
      });
    },
  },
  'followups.update': {
    handler: async (ctx, p) => {
      const member = memberOf(ctx);
      const conversationId = conversationOf(p.conversationId);
      if (!KINDS.includes(p.kind as string)) throw new CloudError('Choose a valid kind.');
      const kind = p.kind as FollowUpKind;
      const action = p.action;
      const known = await ctx.db
        .prepare('SELECT 1 AS ok FROM mail_messages WHERE member = ? AND conversation_id = ? LIMIT 1')
        .bind(member, conversationId)
        .first();
      if (!known) throw notFound('conversation');
      const col = kind === 'waiting' ? 'waiting_done' : 'chasing_done';
      let set: string;
      const values: unknown[] = [];
      if (action === 'snooze') {
        const days = p.days;
        if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 30)
          throw new CloudError('Snooze for 1 to 30 days.');
        set = 'waiting_snoozed_until = ?';
        values.push(ctx.now + days * DAY);
      } else if (action === 'done') set = `${col} = 1`;
      else if (action === 'reopen') set = `${col} = 0, waiting_snoozed_until = NULL`;
      else throw new CloudError('Choose snooze, done or reopen.');
      await ctx.db
        .prepare(
          `INSERT INTO mail_threads(member, conversation_id, waiting_snoozed_until, waiting_done, chasing_done, updated_at)
           VALUES(?, ?, NULL, 0, 0, ?) ON CONFLICT(member, conversation_id) DO NOTHING`,
        )
        .bind(member, conversationId, ctx.now)
        .run();
      await ctx.db
        .prepare(`UPDATE mail_threads SET ${set}, updated_at = ? WHERE member = ? AND conversation_id = ?`)
        .bind(...values, ctx.now, member, conversationId)
        .run();
      return true;
    },
  },
  'followups.draftNudge': {
    handler: async (ctx, p): Promise<Draft> => {
      const member = memberOf(ctx);
      const conversationId = conversationOf(p.conversationId);
      const instructions = text(p.instructions, 'the instructions', 2000);
      const latest = await ctx.db
        .prepare(
          `SELECT * FROM mail_messages WHERE member = ? AND conversation_id = ? ORDER BY received_at DESC, id LIMIT 1`,
        )
        .bind(member, conversationId)
        .first<MessageRow>();
      if (!latest) throw notFound('conversation');
      const me = await meOf(ctx.db, member);
      const lastSent = await ctx.db
        .prepare(
          `SELECT * FROM mail_messages WHERE member = ? AND conversation_id = ? AND folder = 'sent'
           ORDER BY received_at DESC, id LIMIT 1`,
        )
        .bind(member, conversationId)
        .first<MessageRow>();
      if (!lastSent)
        throw new CloudError('You have not written in this thread, so there is nothing to follow up.', 409);
      if (
        latest.folder === 'inbox' &&
        !me.has(latest.from_address) &&
        latest.received_at > lastSent.received_at
      )
        throw new CloudError('They have written since your last email. Reply to their email instead.', 409);
      return createNudge(ctx, lastSent, instructions, Math.floor((ctx.now - lastSent.received_at) / DAY));
    },
  },
};
