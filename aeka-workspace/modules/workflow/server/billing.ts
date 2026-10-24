// Engagement and billing data and invoices (Manager+). The billed amount is always the sum of invoices.
import { CloudError } from '../../../lib/cloud-store.ts';
import type { ModuleAction } from '../../../core/server/module.ts';
import type { Invoice, MatterBilling } from '../shared/types.ts';
import {
  all,
  billing,
  conflict,
  insert,
  invoices,
  one,
  remove,
  saveRevision,
  write,
  type BillingRow,
} from './db.ts';
import { managerOnly, me, visibleChild, visibleMatter } from './permissions.ts';
import { baseRevision, validBilling, validInvoice } from './validate.ts';

const defaults = (matterId: string): BillingRow => ({
  matterId,
  elStatus: 'Not Started',
  invoiceStatus: 'Not Invoiced',
  feePaise: null,
  adminNotes: '',
  revision: 0,
  updatedAt: 0,
});

// Billing for the given matters, with defaults (revision 0) where nothing has been saved yet.
export async function billingFor(db: D1Database, matterIds: string[]): Promise<MatterBilling[]> {
  const saved = new Map((await all(db, billing)).map((b) => [b.matterId, b]));
  const sums = await db
    .prepare('SELECT matter_id AS id, sum(amount_paise) AS n FROM wf_invoices GROUP BY matter_id')
    .bind()
    .all<{ id: string; n: number }>();
  const billed = new Map(sums.results.map((r) => [r.id, r.n]));
  return matterIds.map((id) => ({ ...(saved.get(id) ?? defaults(id)), billedPaise: billed.get(id) ?? 0 }));
}

export const billingActions: Record<string, ModuleAction> = {
  'billing.update': {
    permission: managerOnly,
    handler: async (ctx, p) => {
      const matter = await visibleMatter(ctx, p.matterId);
      const base = baseRevision(p);
      const input = validBilling(p.billing);
      const current = await one(ctx.db, billing, 'matter_id = ?', matter.id);
      if ((current?.revision ?? 0) !== base) throw conflict('billing record');
      const row = { ...(current ?? defaults(matter.id)), ...input, revision: base + 1, updatedAt: ctx.now };
      if (current) await saveRevision(ctx.db, ctx.now, billing, row, base, 'billing record');
      else if (!(await write(ctx.db, ctx.now, [insert(ctx.db, billing, row, true)]))[0])
        throw conflict('billing record');
      await ctx.log('billing.updated', matter.id, `Updated billing for ${matter.title}`);
      return (await billingFor(ctx.db, [matter.id]))[0];
    },
  },
  'invoices.list': {
    permission: managerOnly,
    handler: async (ctx, p) => {
      const matter = await visibleMatter(ctx, p.matterId);
      return all(ctx.db, invoices, 'matter_id = ? ORDER BY date, created_at', matter.id);
    },
  },
  'invoice.create': {
    permission: managerOnly,
    handler: async (ctx, p) => {
      const matter = await visibleMatter(ctx, p.matterId);
      const input = validInvoice(p.invoice);
      if (input.invoiceNo) {
        const clash = await ctx.db
          .prepare('SELECT 1 FROM wf_invoices WHERE matter_id = ? AND lower(invoice_no) = lower(?)')
          .bind(matter.id, input.invoiceNo)
          .first();
        if (clash)
          throw new CloudError(`Invoice ${input.invoiceNo} is already recorded on this matter.`, 409);
      }
      const invoice: Invoice = {
        id: crypto.randomUUID(),
        matterId: matter.id,
        ...input,
        createdBy: me(ctx).email,
        createdAt: ctx.now,
      };
      await write(ctx.db, ctx.now, [insert(ctx.db, invoices, invoice)]);
      const name = invoice.invoiceNo ? `invoice ${invoice.invoiceNo}` : 'an invoice';
      await ctx.log('invoice.created', invoice.id, `Recorded ${name} on ${matter.title}`);
      return invoice;
    },
  },
  'invoice.delete': {
    permission: managerOnly,
    handler: async (ctx, p) => {
      const { record, matter } = await visibleChild(ctx, invoices, p.id, 'invoice');
      await write(ctx.db, ctx.now, [remove(ctx.db, invoices, record.id)]);
      const name = record.invoiceNo ? `invoice ${record.invoiceNo}` : 'an invoice';
      await ctx.log('invoice.deleted', record.id, `Deleted ${name} on ${matter.title}`);
      return true;
    },
  },
};
