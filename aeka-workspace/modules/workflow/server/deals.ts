// Deal tracker: one record per matter, saved whole with a revision check. Edited by the matter team or
// Manager+.
import type { ModuleAction } from '../../../core/server/module.ts';
import { TARGET_DOC_DEFAULTS, type DealTracker } from '../shared/types.ts';
import { conflict, deals, insert, one, saveRevision, write } from './db.ts';
import { forbidden, isManager, me, visibleMatter } from './permissions.ts';
import { baseRevision, validDeal } from './validate.ts';

export const defaultDeal = (matterId: string): DealTracker => ({
  matterId,
  dealValue: '',
  representing: 'Buy Side',
  targetCompany: '',
  targetDocs: TARGET_DOC_DEFAULTS.map((name, i) => ({
    id: `target-${i + 1}`,
    name,
    status: 'Draft Pending',
    notes: '',
  })),
  counterparties: [],
  revision: 0,
  updatedAt: 0,
});

export const dealActions: Record<string, ModuleAction> = {
  'deal.get': {
    handler: async (ctx, p) => {
      const matter = await visibleMatter(ctx, p.matterId);
      return (await one(ctx.db, deals, 'matter_id = ?', matter.id)) ?? defaultDeal(matter.id);
    },
  },
  'deal.save': {
    handler: async (ctx, p) => {
      const matter = await visibleMatter(ctx, p.matterId);
      const m = me(ctx);
      if (!isManager(m) && !matter.team.includes(m.email))
        throw forbidden('Only the matter team or a Manager and above can update the deal tracker.');
      const base = baseRevision(p);
      const input = validDeal(p.deal);
      const current = await one(ctx.db, deals, 'matter_id = ?', matter.id);
      if ((current?.revision ?? 0) !== base) throw conflict('deal tracker');
      const deal: DealTracker = { matterId: matter.id, ...input, revision: base + 1, updatedAt: ctx.now };
      if (current) await saveRevision(ctx.db, ctx.now, deals, deal, base, 'deal tracker');
      else if (!(await write(ctx.db, ctx.now, [insert(ctx.db, deals, deal, true)]))[0])
        throw conflict('deal tracker');
      await ctx.log('deal.updated', matter.id, `Updated the deal tracker for ${matter.title}`);
      return deal;
    },
  },
};
