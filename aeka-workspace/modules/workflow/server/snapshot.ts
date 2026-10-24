// Everything the Workflow screens need in one read, filtered to what the caller may see.
import type { ModuleAction } from '../../../core/server/module.ts';
import type { Snapshot } from '../shared/types.ts';
import { billingFor } from './billing.ts';
import { all, clients, milestones, readVersion, tasks } from './db.ts';
import { capabilities, me, visibleMatters } from './permissions.ts';

export const snapshotActions: Record<string, ModuleAction> = {
  snapshot: {
    handler: async (ctx): Promise<Snapshot> => {
      const caps = capabilities(me(ctx));
      // Read the version first, so a write made during this read shows up as a newer version.
      const version = await readVersion(ctx.db);
      const visible = await visibleMatters(ctx);
      const ids = new Set(visible.map((x) => x.id));
      // A client whose every matter is behind an ethical wall the caller is outside is hidden too.
      const counts = await ctx.db
        .prepare(
          'SELECT client_id AS id, count(*) AS n FROM wf_matters WHERE deleted_at IS NULL GROUP BY client_id',
        )
        .bind()
        .all<{ id: string; n: number }>();
      const shown = new Set(visible.map((x) => x.clientId));
      const walled = new Set(counts.results.filter((r) => r.n > 0 && !shown.has(r.id)).map((r) => r.id));
      return {
        version,
        clients: (await all(ctx.db, clients, 'deleted_at IS NULL ORDER BY name COLLATE NOCASE')).filter(
          (c) => !walled.has(c.id),
        ),
        matters: visible,
        tasks: (await all(ctx.db, tasks, 'deleted_at IS NULL ORDER BY created_at')).filter((t) =>
          ids.has(t.matterId),
        ),
        milestones: (await all(ctx.db, milestones, '1 ORDER BY due_date')).filter((x) => ids.has(x.matterId)),
        billing: caps.viewBilling ? await billingFor(ctx.db, [...ids]) : [],
        capabilities: caps,
      };
    },
  },
  version: { handler: async (ctx) => ({ version: await readVersion(ctx.db) }) },
};
