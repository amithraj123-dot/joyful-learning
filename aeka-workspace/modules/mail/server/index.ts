// Mail server module: the actions of shared/contract.ts (tests check the two match). Every action works
// on the caller's own mailbox: rows are always read by the caller's email, so another member's mail is
// simply not found, administrators included.
import { CloudError } from '../../../lib/cloud-store.ts';
import { aiStatus, usedToday } from '../../../core/server/ai.ts';
import { configured } from '../../../core/server/env.ts';
import { getMember } from '../../../core/server/members.ts';
import type { ModuleAction, ModuleContext, ServerModule } from '../../../core/server/module.ts';
import { sealingAvailable } from '../../../core/server/secrets.ts';
import { createTaskFor, matterTargets } from '../../workflow/server/services.ts';
import type { MailSetup } from '../shared/contract.ts';
import type { AccountSettings } from '../shared/types.ts';
import { createDraft, discardDraft, saveDraftToOutlook, sendDraft, updateDraft } from './drafts.ts';
import { openSession } from './graph.ts';
import { indiaTime } from './prompts.ts';
import { correctionStatement, proposeRules, ruleActions, type CorrectionInput } from './rules.ts';
import { mailboxPass } from './run.ts';
import {
  DAY,
  domainOf,
  getItem,
  HOUR,
  listItems,
  loadAccount,
  loadDraft,
  loadMessage,
  loadTriage,
  memberOf,
  notFound,
  queueCounts,
  settingsOf,
  toAccount,
  toDraft,
  toTriage,
  conflict,
  type DraftRow,
  type TriageRow,
} from './store.ts';
import { archiveActions } from './archive.ts';
import { followUpActions } from './followups.ts';
import { styleActions } from './style.ts';
import { deleteMailData } from './sync.ts';
import { runTriage } from './triage.ts';
import {
  baseRevision,
  bool,
  idOf,
  isCategory,
  isDate,
  isHandling,
  isTier,
  obj,
  recipients,
  text,
  view,
} from './validate.ts';
import { EMAIL } from './validate.ts';

const aiLimit = (ctx: ModuleContext) => {
  const n = Number(ctx.env.AEKA_AI_DAILY_LIMIT);
  return Number.isInteger(n) && n > 0 ? n : 400;
};

async function inboxMessage(ctx: ModuleContext, id: unknown) {
  const member = memberOf(ctx);
  const m = await loadMessage(ctx.db, member, idOf(id));
  if (!m || m.folder !== 'inbox') throw notFound('email');
  const t = await loadTriage(ctx.db, member, m.id);
  if (!t) throw notFound('email');
  return { member, m, t };
}

async function ownDomains(ctx: ModuleContext, member: string) {
  const account = await loadAccount(ctx.db, member);
  return [...new Set([domainOf(member), domainOf(account?.address || '')].filter(Boolean))];
}

const triageUpdate = (db: D1Database, member: string, t: TriageRow, base: number, now: number) =>
  db
    .prepare(
      `UPDATE mail_triage SET status = ?, source = ?, tier = ?, category = ?, handling = ?, reply_needed = ?, delegate = ?,
       matter_id = ?, matter_confidence = ?, corrected = ?, error = ?, triaged_at = ?, updated_at = ?, revision = revision + 1
       WHERE member = ? AND message_id = ? AND revision = ?`,
    )
    .bind(
      t.status,
      t.source,
      t.tier,
      t.category,
      t.handling,
      t.reply_needed,
      t.delegate,
      t.matter_id,
      t.matter_id ? t.matter_confidence : null,
      t.corrected,
      t.error,
      t.triaged_at,
      now,
      member,
      t.message_id,
      base,
    );

async function visibleMatterIds(ctx: ModuleContext) {
  return new Set((await matterTargets(ctx)).map((t) => t.matterId));
}

const accountActions: Record<string, ModuleAction> = {
  'account.get': {
    handler: async (ctx) => {
      const account = await loadAccount(ctx.db, memberOf(ctx));
      const ai = aiStatus(ctx.env);
      const setup: MailSetup = {
        outlookConfigured: configured(ctx.env.MS_CLIENT_ID, ctx.env.MS_CLIENT_SECRET),
        storageReady: sealingAvailable(ctx.env),
        aiReady: ai.ready,
        aiReason: ai.reason,
      };
      return { account: account ? toAccount(account) : null, setup };
    },
  },
  'account.update': {
    handler: async (ctx, p) => {
      const member = memberOf(ctx);
      const s = obj(p.settings, 'settings');
      const current = await loadAccount(ctx.db, member);
      if (!current) throw new CloudError('Connect Outlook first.', 409);
      const was = settingsOf(current);
      // Settings added later keep their current value when an older page leaves them out.
      const optional = (v: unknown, fallback: boolean, label: string) =>
        v === undefined ? fallback : bool(v, label);
      const settings: AccountSettings = {
        aiTriage: bool(s.aiTriage, 'AI triage'),
        alertUrgent: bool(s.alertUrgent, 'urgent alerts'),
        archiveNoise: optional(s.archiveNoise, was.archiveNoise, 'archiving low-priority mail'),
        autoTodos: optional(s.autoTodos, was.autoTodos, 'adding to-dos from mail'),
        trackCommitments: optional(s.trackCommitments, was.trackCommitments, 'tracking commitments'),
      };
      const r = await ctx.db
        .prepare('UPDATE mail_accounts SET settings = ?, updated_at = ? WHERE member = ?')
        .bind(JSON.stringify(settings), ctx.now, member)
        .run();
      if (!r.meta.changes) throw new CloudError('Connect Outlook first.', 409);
      await ctx.log('account.updated', member, 'Changed Outlook triage settings');
      return toAccount((await loadAccount(ctx.db, member))!);
    },
  },
  'account.disconnect': {
    handler: async (ctx) => {
      const member = memberOf(ctx);
      await deleteMailData(ctx.db, member, true);
      await ctx.log('account.disconnected', member, 'Disconnected Outlook');
      return true;
    },
  },
  sync: {
    handler: async (ctx) => {
      const r = await mailboxPass(ctx, ctx.member!, { fromAction: true });
      return r!;
    },
  },
  stats: {
    handler: async (ctx) => {
      const member = memberOf(ctx);
      const since = ctx.now - 30 * DAY;
      const triaged = await ctx.db
        .prepare(
          "SELECT count(*) AS n FROM mail_triage WHERE member = ? AND status = 'done' AND triaged_at >= ?",
        )
        .bind(member, since)
        .first<{ n: number }>();
      const byField = await ctx.db
        .prepare(
          'SELECT field, count(*) AS n, count(DISTINCT message_id) AS m FROM mail_corrections WHERE member = ? AND created_at >= ? GROUP BY field',
        )
        .bind(member, since)
        .all<{ field: string; n: number; m: number }>();
      const corrected = await ctx.db
        .prepare(
          'SELECT count(DISTINCT message_id) AS n FROM mail_corrections WHERE member = ? AND created_at >= ?',
        )
        .bind(member, since)
        .first<{ n: number }>();
      const archived = await ctx.db
        .prepare(
          `SELECT coalesce(sum(CAST(target AS INTEGER)), 0) AS n FROM org_activity WHERE actor = ? AND module = 'mail'
           AND action IN ('message.archived','message.autoArchived') AND at >= ?`,
        )
        .bind(member, since)
        .first<{ n: number }>();
      return {
        triaged30d: triaged?.n ?? 0,
        corrected30d: corrected?.n ?? 0,
        correctionsByField: Object.fromEntries(byField.results.map((r) => [r.field, r.n])),
        aiCallsToday: await usedToday(ctx.db, member, ctx.now),
        aiLimit: aiLimit(ctx),
        // Emails moved to Archive in 30 days, by the member or automatically (each records its count).
        archived30d: Number(archived?.n ?? 0),
      };
    },
  },
};

const inboxActions: Record<string, ModuleAction> = {
  'inbox.list': {
    handler: async (ctx, p) => {
      const member = memberOf(ctx);
      const v = view(p.view);
      const search = text(p.search, 'the search', 200);
      const before = p.before == null ? undefined : Number(p.before);
      if (before !== undefined && !(Number.isFinite(before) && before > 0))
        throw new CloudError('Invalid page.');
      const limit = p.limit == null ? 30 : Number(p.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new CloudError('Ask for 1 to 100 emails.');
      const items = await listItems(ctx.db, member, { view: v, search, before, limit });
      return {
        items,
        counts: await queueCounts(ctx.db, member),
        nextBefore: items.length === limit ? items[items.length - 1].receivedAt : null,
      };
    },
  },
  'message.get': {
    handler: async (ctx, p) => {
      const item = await getItem(ctx.db, memberOf(ctx), idOf(p.id));
      if (!item) throw notFound('email');
      return item;
    },
  },
};

const triageActions: Record<string, ModuleAction> = {
  'triage.correct': {
    handler: async (ctx, p) => {
      const { member, m, t } = await inboxMessage(ctx, p.id);
      const base = baseRevision(p);
      if (t.revision !== base) throw conflict('email');
      const c = obj(p.changes, 'changes');
      const next: TriageRow = { ...t };
      const changed: CorrectionInput[] = [];
      const record = (field: string, from: unknown, to: unknown) =>
        changed.push({
          messageId: m.id,
          field,
          from: String(from ?? ''),
          to: String(to ?? ''),
          sender: m.from_address,
        });
      if (c.tier !== undefined) {
        if (!isTier(c.tier)) throw new CloudError('Choose a valid tier.');
        if (c.tier !== t.tier) {
          record('tier', t.tier, c.tier);
          next.tier = c.tier;
        }
      }
      if (c.category !== undefined) {
        if (!isCategory(c.category)) throw new CloudError('Choose a valid category.');
        if (c.category !== t.category) {
          record('category', t.category, c.category);
          next.category = c.category;
        }
      }
      if (c.handling !== undefined) {
        if (!isHandling(c.handling)) throw new CloudError('Choose a valid handling.');
        if (c.handling !== t.handling) {
          record('handling', t.handling, c.handling);
          next.handling = c.handling;
          if (c.handling === 'reply') next.reply_needed = 'yes';
          if (c.handling === 'none' || c.handling === 'info') next.reply_needed = 'no';
        }
      }
      if (c.delegate !== undefined) {
        let d: string | null = null;
        if (c.delegate !== null) {
          const person =
            typeof c.delegate === 'string' && EMAIL.test(c.delegate)
              ? await getMember(ctx.db, c.delegate)
              : null;
          if (!person?.active) throw new CloudError('Choose an active team member to delegate to.');
          d = person.email;
        }
        if (d !== t.delegate) {
          record('delegate', t.delegate, d);
          next.delegate = d;
        }
      }
      if (c.matterId !== undefined) {
        if (c.matterId === null) {
          if (t.matter_id) record('matterId', t.matter_id, '');
          next.matter_id = null;
          next.matter_confidence = null;
        } else {
          if (typeof c.matterId !== 'string' || !(await visibleMatterIds(ctx)).has(c.matterId))
            throw new CloudError('This mandate could not be found.', 404);
          // A confirmation of the suggested mandate also counts: it teaches the sender's link.
          if (c.matterId !== t.matter_id || t.matter_confidence !== 'confirmed')
            record('matterId', t.matter_id, c.matterId);
          next.matter_id = c.matterId;
          next.matter_confidence = 'confirmed';
        }
      }
      if (!changed.length) return toTriage(t);
      next.corrected = 1;
      next.source = 'manual';
      if (t.status !== 'done') {
        next.status = 'done';
        next.error = '';
        next.triaged_at = ctx.now;
      }
      const [r] = await ctx.db.batch([
        triageUpdate(ctx.db, member, next, base, ctx.now),
        ...changed.map((x) => correctionStatement(ctx.db, member, x, ctx.now)),
      ]);
      if (!r.meta.changes) throw conflict('email');
      await proposeRules(ctx.db, member, changed, await ownDomains(ctx, member), ctx.now);
      return toTriage((await loadTriage(ctx.db, member, m.id))!);
    },
  },
  'triage.retry': {
    handler: async (ctx, p) => {
      const { member, m, t } = await inboxMessage(ctx, p.id);
      if (t.status !== 'failed')
        throw new CloudError('Only emails that could not be triaged can be tried again.', 409);
      await ctx.db
        .prepare(
          `UPDATE mail_triage SET status = 'pending', attempts = 0, next_attempt_at = 0, error = '', updated_at = ?,
           revision = revision + 1 WHERE member = ? AND message_id = ? AND status = 'failed'`,
        )
        .bind(ctx.now - HOUR, member, m.id)
        .run();
      const account = await loadAccount(ctx.db, member);
      if (account?.status === 'connected') {
        const session = await openSession(ctx, member);
        await runTriage(ctx, ctx.member!, account, session, { only: [m.id], maxAi: 1 });
      }
      return toTriage((await loadTriage(ctx.db, member, m.id))!);
    },
  },
  'triage.decide': {
    handler: async (ctx, p) => {
      const { member, m, t } = await inboxMessage(ctx, p.id);
      const base = baseRevision(p);
      const want = bool(p.wantDraft, 'drafting a reply');
      const r = await ctx.db
        .prepare(
          'UPDATE mail_triage SET draft_decision = ?, updated_at = ?, revision = revision + 1 WHERE member = ? AND message_id = ? AND revision = ?',
        )
        .bind(want ? 'wanted' : 'declined', ctx.now, member, m.id, base)
        .run();
      if (!r.meta.changes || t.revision !== base) throw conflict('email');
      return toTriage((await loadTriage(ctx.db, member, m.id))!);
    },
  },
  'task.fromMail': {
    handler: async (ctx, p) => {
      const { member, m, t } = await inboxMessage(ctx, p.id);
      const title = text(p.title, 'the task title', 200, true);
      if (p.dueDate != null && p.dueDate !== '' && !isDate(p.dueDate))
        throw new CloudError('Enter the due date as a valid date (YYYY-MM-DD).');
      const task = await createTaskFor(
        ctx,
        {
          matterId: typeof p.matterId === 'string' ? p.matterId : '',
          title,
          assignee: typeof p.assignee === 'string' && p.assignee ? p.assignee : null,
          dueDate: isDate(p.dueDate) ? p.dueDate : null,
          notes:
            `From an email from ${m.from_name || m.from_address} received ${indiaTime(m.received_at)}: ${m.subject}`.slice(
              0,
              1000,
            ),
        },
        'from an email',
      );
      // The member has tied this sender to the mandate: later mail from them links without AI.
      const statements = [
        ctx.db
          .prepare(
            `UPDATE mail_triage SET matter_id = ?, matter_confidence = 'confirmed', updated_at = ?, revision = revision + 1
             WHERE member = ? AND message_id = ?`,
          )
          .bind(task.matterId, ctx.now, member, m.id),
      ];
      const link: CorrectionInput = {
        messageId: m.id,
        field: 'matterId',
        from: t.matter_id ?? '',
        to: task.matterId,
        sender: m.from_address,
      };
      if (t.matter_id !== task.matterId || t.matter_confidence !== 'confirmed')
        statements.push(correctionStatement(ctx.db, member, link, ctx.now));
      await ctx.db.batch(statements);
      if (statements.length > 1)
        await proposeRules(ctx.db, member, [link], await ownDomains(ctx, member), ctx.now);
      return { taskId: task.id };
    },
  },
};

type DraftListRow = DraftRow & {
  subject: string;
  from_name: string;
  from_address: string;
  received_at: number;
};

const draftActions: Record<string, ModuleAction> = {
  'draft.create': { handler: (ctx, p) => createDraft(ctx, idOf(p.id), p.instructions, p.replyAll) },
  'drafts.list': {
    handler: async (ctx, p) => {
      const member = memberOf(ctx);
      const includeSent = p.includeSent == null ? false : bool(p.includeSent, 'sent replies');
      const query = (status: string, limit: number) =>
        ctx.db
          .prepare(
            `SELECT d.*, m.subject, m.from_name, m.from_address, m.received_at FROM mail_drafts d
             JOIN mail_messages m ON m.id = d.message_id AND m.member = d.member
             WHERE d.member = ? AND d.status IN (${status}) ORDER BY d.updated_at DESC, d.rowid DESC LIMIT ?`,
          )
          .bind(member, limit)
          .all<DraftListRow>();
      const rows = [
        ...(await query("'draft','saved'", 200)).results,
        ...(includeSent ? (await query("'sent'", 20)).results : []),
      ];
      return rows.map((r) => ({
        ...toDraft(r),
        subject: r.subject,
        from: { name: r.from_name, address: r.from_address },
        receivedAt: r.received_at,
      }));
    },
  },
  'draft.get': {
    handler: async (ctx, p) => {
      const d = await loadDraft(ctx.db, memberOf(ctx), idOf(p.id, 'draft'));
      if (!d) throw notFound('draft');
      return toDraft(d);
    },
  },
  'draft.update': {
    handler: (ctx, p) =>
      updateDraft(
        ctx,
        idOf(p.draftId, 'draft'),
        {
          body: text(p.body, 'the reply', 20000, true),
          to: recipients(p.to, 'To'),
          cc: recipients(p.cc ?? [], 'Cc'),
          replyAll: bool(p.replyAll, 'reply all'),
        },
        baseRevision(p),
      ),
  },
  'draft.saveToOutlook': {
    handler: (ctx, p) => saveDraftToOutlook(ctx, idOf(p.draftId, 'draft'), baseRevision(p)),
  },
  'draft.send': {
    handler: (ctx, p) => sendDraft(ctx, idOf(p.draftId, 'draft'), p.confirm, baseRevision(p)),
  },
  'draft.discard': {
    handler: (ctx, p) => discardDraft(ctx, idOf(p.draftId, 'draft'), baseRevision(p)),
  },
};

export const mailServer: ServerModule = {
  id: 'mail',
  actions: {
    ...accountActions,
    ...inboxActions,
    ...triageActions,
    ...draftActions,
    ...ruleActions,
    ...archiveActions,
    ...followUpActions,
    ...styleActions,
  },
  // Sync and triage for a member with a connected account; housekeeping of expired sign-in states.
  tick: async (sys, { member }) => {
    if (!member) return;
    await sys.db
      .prepare('DELETE FROM mail_oauth_states WHERE created_at < ?')
      .bind(sys.now - 10 * 60000)
      .run();
    await mailboxPass(sys, member);
  },
};
