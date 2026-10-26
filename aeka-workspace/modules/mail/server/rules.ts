// Member rules and learning. Rules apply after the built-in checks: sender first, then domain, then
// subject phrase. Corrections are recorded one row per changed field; three or more corrections of
// the same field to the same value for one sender (or a non-public domain) in 60 days propose a rule,
// which applies only after the member accepts it. Confirmed mandate links come from the member's own
// corrections and tasks made from mail.
import { CloudError } from '../../../lib/cloud-store.ts';
import type { ModuleAction, ModuleContext } from '../../../core/server/module.ts';
import { matterTargets } from '../../workflow/server/services.ts';
import type { MailRule, RuleEffect } from '../shared/types.ts';
import {
  DAY,
  domainOf,
  isPublicDomain,
  listRules,
  memberOf,
  notFound,
  toRule,
  type RuleRow,
} from './store.ts';
import { idOf, obj, rulePattern, ruleEffect } from './validate.ts';

const LEARN_WINDOW_MS = 60 * DAY;
const PROPOSE_AT = 3;
// Fields a rule can carry, as stored in mail_corrections.field.
const RULE_FIELDS = ['tier', 'category', 'handling', 'matterId'] as const;

// The merged effect of the active rules matching a message (sender beats domain beats subject).
export function matchRules(rules: MailRule[], from: string, subject: string) {
  const address = from.toLowerCase();
  const domain = domainOf(address);
  const s = subject.toLowerCase();
  const hits = rules.filter(
    (r) =>
      r.status === 'active' &&
      ((r.kind === 'sender' && r.pattern === address) ||
        (r.kind === 'domain' && !!domain && (domain === r.pattern || domain.endsWith('.' + r.pattern))) ||
        (r.kind === 'subject' && s.includes(r.pattern))),
  );
  if (!hits.length) return null;
  const order = { sender: 0, domain: 1, subject: 2 };
  hits.sort((a, b) => order[a.kind] - order[b.kind]);
  const effect: RuleEffect = {};
  for (const r of [...hits].reverse()) Object.assign(effect, r.effect);
  return { effect, kind: hits[0].kind };
}

// The mandate the member last confirmed for this sender, else for the sender's domain (not public).
// An explicit unlink for the sender stops the lookup. Only mandates in `visible` count.
export async function confirmedLink(
  db: D1Database,
  member: string,
  sender: string,
  visible: Set<string>,
): Promise<string | null> {
  const latest = (col: 'sender' | 'domain', value: string) =>
    db
      .prepare(
        `SELECT to_value FROM mail_corrections WHERE member = ? AND field = 'matterId' AND ${col} = ?
         ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .bind(member, value)
      .first<{ to_value: string }>();
  const own = await latest('sender', sender.toLowerCase());
  if (own) return own.to_value && visible.has(own.to_value) ? own.to_value : null;
  const domain = domainOf(sender);
  if (isPublicDomain(domain)) return null;
  const shared = await latest('domain', domain);
  return shared?.to_value && visible.has(shared.to_value) ? shared.to_value : null;
}

export interface CorrectionInput {
  messageId: string;
  field: string;
  from: string;
  to: string;
  sender: string;
}

export function correctionStatement(db: D1Database, member: string, c: CorrectionInput, now: number) {
  return db
    .prepare(
      'INSERT INTO mail_corrections(id,member,message_id,field,from_value,to_value,sender,domain,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    )
    .bind(
      crypto.randomUUID(),
      member,
      c.messageId,
      c.field,
      c.from.slice(0, 200),
      c.to.slice(0, 200),
      c.sender.toLowerCase(),
      domainOf(c.sender),
      now,
    );
}

const effectValue = (field: (typeof RULE_FIELDS)[number], value: string) =>
  field === 'tier' ? Number(value) : value;

// After corrections are written: propose or strengthen rules where the evidence is repeated.
export async function proposeRules(
  db: D1Database,
  member: string,
  corrections: CorrectionInput[],
  ownDomains: string[],
  now: number,
) {
  for (const c of corrections) {
    const field = RULE_FIELDS.find((f) => f === c.field);
    if (!field || !c.to) continue;
    const count = async (col: 'sender' | 'domain', value: string) =>
      (
        await db
          .prepare(
            `SELECT count(*) AS n FROM mail_corrections WHERE member = ? AND field = ? AND to_value = ? AND ${col} = ? AND created_at >= ?`,
          )
          .bind(member, field, c.to, value, now - LEARN_WINDOW_MS)
          .first<{ n: number }>()
      )?.n ?? 0;
    const sender = c.sender.toLowerCase();
    const domain = domainOf(sender);
    let kind: MailRule['kind'] | null = null,
      pattern = '',
      evidence = await count('sender', sender);
    if (evidence >= PROPOSE_AT) {
      kind = 'sender';
      pattern = sender;
    } else if (!isPublicDomain(domain) && !ownDomains.includes(domain)) {
      evidence = await count('domain', domain);
      if (evidence >= PROPOSE_AT) {
        kind = 'domain';
        pattern = domain;
      }
    }
    if (!kind) continue;
    const existing = await db
      .prepare('SELECT * FROM mail_rules WHERE member = ? AND kind = ? AND pattern = ?')
      .bind(member, kind, pattern)
      .first<RuleRow>();
    const value = effectValue(field, c.to);
    if (!existing) {
      await db
        .prepare(
          `INSERT INTO mail_rules(id,member,kind,pattern,effect,status,evidence,created_at,updated_at)
           VALUES(?,?,?,?,?,'proposed',?,?,?) ON CONFLICT DO NOTHING`,
        )
        .bind(crypto.randomUUID(), member, kind, pattern, JSON.stringify({ [field]: value }), evidence, now, now)
        .run();
      continue;
    }
    const effect = toRule(existing).effect as Record<string, unknown>;
    // A proposal takes the new evidence; an accepted or rejected rule is never changed silently.
    if (existing.status === 'proposed') effect[field] = value;
    else if (effect[field] !== value) continue;
    await db
      .prepare('UPDATE mail_rules SET effect = ?, evidence = ?, updated_at = ? WHERE id = ? AND member = ?')
      .bind(JSON.stringify(effect), Math.max(existing.evidence, evidence), now, existing.id, member)
      .run();
  }
}

async function checkMatter(ctx: ModuleContext, effect: RuleEffect) {
  if (!effect.matterId) return;
  const visible = new Set((await matterTargets(ctx)).map((t) => t.matterId));
  if (!visible.has(effect.matterId)) throw new CloudError('This mandate could not be found.', 404);
}

export const ruleActions: Record<string, ModuleAction> = {
  'rules.list': { handler: (ctx) => listRules(ctx.db, memberOf(ctx)) },
  'rules.save': {
    handler: async (ctx, p) => {
      const member = memberOf(ctx);
      const r = obj(p.rule, 'rule');
      const kind = r.kind as MailRule['kind'];
      if (!['sender', 'domain', 'subject'].includes(kind)) throw new CloudError('Choose a valid rule kind.');
      const status = r.status as MailRule['status'];
      if (!['proposed', 'active', 'rejected'].includes(status)) throw new CloudError('Choose a valid rule status.');
      const pattern = rulePattern(kind, r.pattern);
      const effect = ruleEffect(r.effect);
      await checkMatter(ctx, effect);
      let existing: RuleRow | null = null;
      if (r.id != null) {
        existing = await ctx.db
          .prepare('SELECT * FROM mail_rules WHERE member = ? AND id = ?')
          .bind(member, idOf(r.id, 'rule'))
          .first<RuleRow>();
        if (!existing) throw notFound('rule');
      } else
        existing = await ctx.db
          .prepare('SELECT * FROM mail_rules WHERE member = ? AND kind = ? AND pattern = ?')
          .bind(member, kind, pattern)
          .first<RuleRow>();
      const id = existing?.id ?? crypto.randomUUID();
      try {
        if (existing)
          await ctx.db
            .prepare(
              'UPDATE mail_rules SET kind = ?, pattern = ?, effect = ?, status = ?, updated_at = ? WHERE id = ? AND member = ?',
            )
            .bind(kind, pattern, JSON.stringify(effect), status, ctx.now, id, member)
            .run();
        else
          await ctx.db
            .prepare(
              'INSERT INTO mail_rules(id,member,kind,pattern,effect,status,evidence,created_at,updated_at) VALUES(?,?,?,?,?,?,0,?,?)',
            )
            .bind(id, member, kind, pattern, JSON.stringify(effect), status, ctx.now, ctx.now)
            .run();
      } catch (e) {
        if (e instanceof Error && /unique|constraint/i.test(e.message))
          throw new CloudError('You already have a rule for this pattern. Edit that rule instead.', 409);
        throw e;
      }
      const saved = await ctx.db
        .prepare('SELECT * FROM mail_rules WHERE member = ? AND id = ?')
        .bind(member, id)
        .first<RuleRow>();
      return toRule(saved!);
    },
  },
  'rules.delete': {
    handler: async (ctx, p) => {
      const r = await ctx.db
        .prepare('DELETE FROM mail_rules WHERE member = ? AND id = ?')
        .bind(memberOf(ctx), idOf(p.id, 'rule'))
        .run();
      if (!r.meta.changes) throw notFound('rule');
      return true;
    },
  },
};
