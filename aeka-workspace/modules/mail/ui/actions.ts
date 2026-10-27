// Mail actions shared by several pages: archiving, and VIPs.
//
// VIPs are rules with the effect `vip`. A rule for the same sender or domain keeps its other effects:
// marking adds `vip` to it, removing takes `vip` away and deletes the rule only when nothing is left.
import { mail } from '../shared/client';
import type { MailRule, RuleEffect } from '../shared/types';
import { domainOf } from './lib';

export type VipKind = 'sender' | 'domain';

export const isVipRule = (r: MailRule) => r.status === 'active' && !!r.effect.vip;
// A rule whose only effect is VIP is shown in the VIP list and not again among the other rules.
export const onlyVip = (e: RuleEffect) => Object.keys(e).every((k) => k === 'vip');

export async function markVip(kind: VipKind, pattern: string, rules?: MailRule[]): Promise<MailRule> {
  const p = pattern.trim().toLowerCase().replace(/^@/, '');
  const list = rules ?? (await mail('rules.list', {}));
  const same = list.find((r) => r.kind === kind && r.pattern === p);
  if (same && isVipRule(same)) return same;
  // A suggestion or a rejected rule for the pattern is replaced: its other effects were never accepted.
  const effect: RuleEffect = same?.status === 'active' ? { ...same.effect, vip: true } : { vip: true };
  return mail('rules.save', {
    rule: { ...(same ? { id: same.id } : {}), kind, pattern: p, effect, status: 'active' },
  });
}

// Removes VIP status from a rule; returns the remaining rule, or null when the rule was deleted.
export async function clearVip(rule: MailRule): Promise<MailRule | null> {
  const effect: RuleEffect = { ...rule.effect };
  delete effect.vip;
  if (!Object.keys(effect).length) {
    await mail('rules.delete', { id: rule.id });
    return null;
  }
  return mail('rules.save', {
    rule: { id: rule.id, kind: rule.kind, pattern: rule.pattern, effect, status: rule.status },
  });
}

// The VIP rule that makes this address a VIP: the person first, then their domain.
export async function vipRuleFor(address: string): Promise<MailRule | null> {
  const a = address.toLowerCase();
  const list = (await mail('rules.list', {})).filter(isVipRule);
  return (
    list.find((r) => r.kind === 'sender' && r.pattern === a) ??
    list.find((r) => r.kind === 'domain' && r.pattern === domainOf(a)) ??
    null
  );
}

const ARCHIVE_BATCH = 100; // the most message.archive takes at once

// Archives in batches; returns how many Outlook moved.
export async function archiveIds(ids: string[]) {
  let archived = 0;
  for (let at = 0; at < ids.length; at += ARCHIVE_BATCH)
    archived += (await mail('message.archive', { ids: ids.slice(at, at + ARCHIVE_BATCH) })).archived;
  return archived;
}
