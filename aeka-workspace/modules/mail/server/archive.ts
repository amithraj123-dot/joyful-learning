// Archiving: moves my emails to Outlook's Archive folder (Graph move with destinationId "archive", the
// only move the allow-list permits, and only for messages of my stored inbox). A message counts as
// archived only when Outlook confirms the move; it then leaves the triage views (removed_at, which the
// next delta would set anyway). Outlook keeps the message, so the member can move it back there.
//
// Automatic archiving of noise is off by default. When the member turns it on, the background pass
// moves at most 50 emails per pass, only tier 4 newsletters and notifications triaged by the built-in
// checks or the member's own rules, never mail from a VIP, never mail linked to a mandate, never mail
// with a draft. Each pass that archives records the count in the member's activity.
import { CloudError } from '../../../lib/cloud-store.ts';
import type { ModuleAction, ModuleContext } from '../../../core/server/module.ts';
import { GraphError, graphProblem, openSession, type GraphSession } from './graph.ts';
import { isVip, listRules, memberOf, settingsOf, type AccountRow, type MessageRow } from './store.ts';

export const AUTO_ARCHIVE_MAX = 50;
const MANUAL_MAX = 100;
const ID = /^[A-Za-z0-9_-]{1,80}$/;

type Outcome = 'archived' | 'gone' | 'stopped';

// One move. 'gone': Outlook no longer has it in the Inbox (it is marked removed, not counted).
async function moveOne(s: GraphSession, m: Pick<MessageRow, 'id' | 'graph_id'>): Promise<Outcome> {
  const { db, now } = s.sys;
  try {
    await s.request('POST', `/me/messages/${encodeURIComponent(m.graph_id)}/move`, {
      destinationId: 'archive',
    });
  } catch (e) {
    if (e instanceof GraphError && e.status === 404) {
      await db
        .prepare(
          'UPDATE mail_messages SET removed_at = ?, updated_at = ? WHERE member = ? AND id = ? AND removed_at IS NULL',
        )
        .bind(now, now, s.account.member, m.id)
        .run();
      return 'gone';
    }
    throw e;
  }
  await db
    .prepare(
      'UPDATE mail_messages SET removed_at = ?, updated_at = ? WHERE member = ? AND id = ? AND removed_at IS NULL',
    )
    .bind(now, now, s.account.member, m.id)
    .run();
  return 'archived';
}

// The member's explicit archive of up to 100 of their inbox emails. Stops at the first Outlook failure;
// what was archived before it is kept and reported.
export async function archiveMessages(ctx: ModuleContext, ids: unknown) {
  const member = memberOf(ctx);
  if (!Array.isArray(ids) || !ids.length) throw new CloudError('Choose the emails to archive.');
  if (ids.length > MANUAL_MAX) throw new CloudError(`Archive at most ${MANUAL_MAX} emails at a time.`);
  const wanted = [...new Set(ids)];
  if (!wanted.every((id) => typeof id === 'string' && ID.test(id)))
    throw new CloudError('This email could not be found.', 404);
  const rows = (
    await ctx.db
      .prepare(
        `SELECT id, graph_id FROM mail_messages WHERE member = ? AND folder = 'inbox' AND removed_at IS NULL
         AND id IN (${wanted.map(() => '?').join(',')})`,
      )
      .bind(member, ...wanted)
      .all<Pick<MessageRow, 'id' | 'graph_id'>>()
  ).results;
  if (!rows.length) throw new CloudError('These emails are no longer in your Inbox.', 404);
  const s = await openSession(ctx, member);
  let archived = 0;
  for (const m of rows) {
    try {
      if ((await moveOne(s, m)) === 'archived') archived++;
    } catch (e) {
      if (!archived) graphProblem(e);
      break;
    }
  }
  if (archived)
    await ctx.log(
      'message.archived',
      String(archived), // the count, as for automatic archiving (the stats add both up)
      `Archived ${archived} email${archived === 1 ? '' : 's'} to Outlook`,
    );
  return { archived };
}

// The background pass: archives eligible noise when the member has turned it on.
export async function autoArchive(s: GraphSession, account: AccountRow, log: ModuleContext['log']) {
  if (!settingsOf(account).archiveNoise) return 0;
  const { db } = s.sys;
  const member = account.member;
  const rows = (
    await db
      .prepare(
        `SELECT m.id, m.graph_id, m.from_address FROM mail_messages m JOIN mail_triage t ON t.message_id = m.id AND t.member = m.member
         WHERE m.member = ? AND m.folder = 'inbox' AND m.removed_at IS NULL AND t.status = 'done' AND t.tier = 4
         AND t.source IN ('rules','rule') AND t.category IN ('newsletter','notification') AND t.matter_id IS NULL
         AND t.corrected = 0 AND t.safety_flag IS NULL
         AND NOT EXISTS (SELECT 1 FROM mail_drafts d WHERE d.member = m.member AND d.message_id = m.id AND d.status != 'discarded')
         ORDER BY m.received_at ASC LIMIT ?`,
      )
      .bind(member, AUTO_ARCHIVE_MAX * 2)
      .all<Pick<MessageRow, 'id' | 'graph_id' | 'from_address'>>()
  ).results;
  if (!rows.length) return 0;
  const rules = await listRules(db, member, 'active');
  let archived = 0;
  for (const m of rows.filter((r) => !isVip(rules, r.from_address)).slice(0, AUTO_ARCHIVE_MAX)) {
    try {
      if ((await moveOne(s, m)) === 'archived') archived++;
    } catch (e) {
      // Throttling, network or sign-in trouble: the rest wait for a later pass.
      if (e instanceof GraphError || e instanceof CloudError) break;
      throw e;
    }
  }
  if (archived)
    await log(
      'message.autoArchived',
      String(archived),
      `Archived ${archived} low-priority email${archived === 1 ? '' : 's'} to Outlook automatically`,
    );
  return archived;
}

export const archiveActions: Record<string, ModuleAction> = {
  'message.archive': { handler: (ctx, p) => archiveMessages(ctx, p.ids) },
};
