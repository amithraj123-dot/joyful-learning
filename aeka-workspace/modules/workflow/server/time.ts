// Timesheet entries. Members record and see their own time; Manager+ also others'. Owners may change an
// entry for 30 days after recording it.
import { CloudError } from '../../../lib/cloud-store.ts';
import type { Member } from '../../../core/server/members.ts';
import type { ModuleAction, ModuleContext } from '../../../core/server/module.ts';
import { todayIST, type TimeEntry } from '../shared/types.ts';
import { all, insert, remove, time, update, write } from './db.ts';
import { loadPeople } from './people.ts';
import {
  assertInsideWall,
  forbidden,
  isManager,
  me,
  visibleChild,
  visibleMatter,
  visibleMatters,
} from './permissions.ts';
import { date, daysBetween, obj, personShape, timeFields } from './validate.ts';

const OWNER_EDIT_MS = 30 * 86400000;
const MAX_RANGE_DAYS = 731;
export const hours = (minutes: number) => (minutes / 60).toFixed(2);

async function timeInput(ctx: ModuleContext, value: unknown, current?: TimeEntry) {
  const e = obj(value, 'time entry');
  const m = me(ctx);
  const matter = await visibleMatter(ctx, e.matterId);
  const people = await loadPeople(ctx.db);
  const person = await people.check(e.person, 'person', current ? [current.person] : []);
  if (person !== m.email && !isManager(m))
    throw forbidden('Only a Manager or above can record time for someone else.');
  if (current?.person !== person || current.matterId !== matter.id)
    assertInsideWall(people, matter, [person]);
  const fields = timeFields(e);
  if (fields.date > todayIST(ctx.now)) throw new CloudError('Time cannot be recorded for a future date.');
  const day = await ctx.db
    .prepare('SELECT coalesce(sum(minutes), 0) AS n FROM wf_time WHERE person = ? AND date = ? AND id != ?')
    .bind(person, fields.date, current?.id ?? '')
    .first<{ n: number }>();
  if ((day?.n ?? 0) + fields.minutes > 1440)
    throw new CloudError(
      `This would record more than 24 hours for ${people.name(person)} on ${fields.date}.`,
    );
  const entry = { ...fields, matterId: matter.id, person };
  return { matter, entry, who: people.name(person) };
}

function assertMayChange(m: Member, entry: TimeEntry, now: number) {
  if (isManager(m)) return;
  if (entry.person !== m.email) throw forbidden("Only a Manager or above can change someone else's time.");
  if (now - entry.createdAt > OWNER_EDIT_MS)
    throw forbidden(
      'Time entries can be changed by their owner for 30 days after they are recorded. Ask a Manager to make this change.',
    );
}

export function dateRange(p: Record<string, unknown>) {
  const from = date(p.from, 'the start date');
  const to = date(p.to, 'the end date');
  if (to < from) throw new CloudError('The end date must be on or after the start date.');
  if (daysBetween(from, to) > MAX_RANGE_DAYS) throw new CloudError('Choose a period of up to two years.');
  return { from, to };
}

// Time in a date range on matters the caller may see, optionally for one matter, client or person.
export async function timeIn(
  ctx: ModuleContext,
  range: { from: string; to: string },
  only: { matterId?: string; clientId?: string; person?: string | null } = {},
) {
  const visible = (await visibleMatters(ctx)).filter((x) => !only.clientId || x.clientId === only.clientId);
  const ids = new Set(visible.map((x) => x.id));
  const where = ['date >= ?', 'date <= ?'];
  const params: unknown[] = [range.from, range.to];
  if (only.matterId) {
    where.push('matter_id = ?');
    params.push(only.matterId);
  }
  if (only.person) {
    where.push('person = ?');
    params.push(only.person);
  }
  const rows = await all(
    ctx.db,
    time,
    where.join(' AND ') + ' ORDER BY date DESC, created_at DESC',
    ...params,
  );
  return { entries: rows.filter((e) => ids.has(e.matterId)), matters: visible };
}

export const timeActions: Record<string, ModuleAction> = {
  'time.list': {
    handler: async (ctx, p) => {
      const m = me(ctx);
      const range = dateRange(p);
      const person = p.person ? personShape(p.person, 'person') : isManager(m) ? null : m.email;
      if (person !== m.email && !isManager(m))
        throw forbidden("Only a Manager or above can view others' time.");
      const matterId = p.matterId == null ? undefined : (await visibleMatter(ctx, p.matterId)).id;
      return (await timeIn(ctx, range, { matterId, person })).entries;
    },
  },
  'time.create': {
    handler: async (ctx, p) => {
      const { matter, entry: input, who } = await timeInput(ctx, p.entry);
      const entry: TimeEntry = {
        id: crypto.randomUUID(),
        ...input,
        createdBy: me(ctx).email,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      };
      await write(ctx.db, ctx.now, [insert(ctx.db, time, entry)]);
      await ctx.log(
        'time.created',
        entry.id,
        `Logged ${hours(entry.minutes)} hours for ${who} on ${matter.title} (${entry.date})`,
      );
      return entry;
    },
  },
  'time.update': {
    handler: async (ctx, p) => {
      const { record: current } = await visibleChild(ctx, time, p.id, 'time entry');
      assertMayChange(me(ctx), current, ctx.now);
      const { matter, entry: input, who } = await timeInput(ctx, p.entry, current);
      const entry = { ...current, ...input, updatedAt: ctx.now };
      await write(ctx.db, ctx.now, [update(ctx.db, time, entry)]);
      await ctx.log('time.updated', entry.id, `Updated time for ${who} on ${matter.title} (${entry.date})`);
      return entry;
    },
  },
  'time.delete': {
    handler: async (ctx, p) => {
      const { record, matter } = await visibleChild(ctx, time, p.id, 'time entry');
      assertMayChange(me(ctx), record, ctx.now);
      await write(ctx.db, ctx.now, [remove(ctx.db, time, record.id)]);
      const who = (await loadPeople(ctx.db)).name(record.person);
      await ctx.log('time.deleted', record.id, `Deleted time for ${who} on ${matter.title} (${record.date})`);
      return true;
    },
  },
};
