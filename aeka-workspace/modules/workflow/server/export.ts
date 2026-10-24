// Timesheet export as CSV: UTF-8 BOM, CRLF line ends, RFC 4180 quoting, and cells that a spreadsheet
// would run as a formula prefixed with an apostrophe.
import type { ModuleAction } from '../../../core/server/module.ts';
import { all, clients, notFound } from './db.ts';
import { loadPeople } from './people.ts';
import { capabilities, me } from './permissions.ts';
import { dateRange, hours, timeIn } from './time.ts';
import { id, oneOf } from './validate.ts';

const GROUPS = ['raw', 'client', 'matter', 'person'] as const;

export function csvCell(value: string | number) {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (rows: (string | number)[][]) =>
  '﻿' + rows.map((r) => r.map(csvCell).join(',') + '\r\n').join('');

const byText = (a: string, b: string) => a.localeCompare(b, 'en-IN');

export const exportAction: ModuleAction = {
  handler: async (ctx, p) => {
    const m = me(ctx);
    const range = dateRange(p);
    const group = oneOf(p.group, GROUPS, 'grouping');
    const clientNames = new Map(
      (await all(ctx.db, clients, 'deleted_at IS NULL')).map((c) => [c.id, c.name] as const),
    );
    const clientId = p.clientId == null || p.clientId === '' ? undefined : id(p.clientId);
    if (clientId !== undefined && !clientNames.has(clientId)) throw notFound('client');
    // Members export only their own time unless they may export the firm's.
    const firm = capabilities(m).exportFirmTime;
    const { entries, matters } = await timeIn(ctx, range, { clientId, person: firm ? null : m.email });
    const matterById = new Map(matters.map((x) => [x.id, x]));
    const people = await loadPeople(ctx.db);

    const lines = entries.map((e) => {
      const matter = matterById.get(e.matterId)!;
      return {
        e,
        clientId: matter.clientId,
        client: clientNames.get(matter.clientId) || '',
        matter: matter.title,
        type: matter.type,
        name: people.name(e.person),
        initials: people.initials(e.person),
      };
    });

    let rows: (string | number)[][];
    if (group === 'raw') {
      lines.sort(
        (a, b) =>
          byText(a.e.date, b.e.date) ||
          byText(a.client, b.client) ||
          byText(a.matter, b.matter) ||
          byText(a.name, b.name),
      );
      rows = [
        ['Client', 'Mandate', 'Type', 'Person name', 'Initials', 'Date', 'Hours', 'Billable', 'Description'],
        ...lines.map((l) => [
          l.client,
          l.matter,
          l.type,
          l.name,
          l.initials,
          l.e.date,
          hours(l.e.minutes),
          l.e.billable ? 'Yes' : 'No',
          l.e.description,
        ]),
      ];
    } else {
      const label = (l: (typeof lines)[number]) =>
        group === 'client'
          ? [l.client]
          : group === 'matter'
            ? [l.client, l.matter, l.type]
            : [l.name, l.initials];
      const key = (l: (typeof lines)[number]) =>
        group === 'client' ? l.clientId : group === 'matter' ? l.e.matterId : l.e.person;
      const totals = new Map<string, { label: string[]; minutes: number; billable: number }>();
      for (const l of lines) {
        const t = totals.get(key(l)) ?? { label: label(l), minutes: 0, billable: 0 };
        t.minutes += l.e.minutes;
        if (l.e.billable) t.billable += l.e.minutes;
        totals.set(key(l), t);
      }
      const sorted = [...totals.values()].sort(
        (a, b) => b.minutes - a.minutes || byText(a.label.join(' '), b.label.join(' ')),
      );
      const head =
        group === 'client'
          ? ['Client']
          : group === 'matter'
            ? ['Client', 'Mandate', 'Type']
            : ['Person name', 'Initials'];
      const sum = (f: 'minutes' | 'billable') => sorted.reduce((n, t) => n + t[f], 0);
      rows = [
        [...head, 'Hours', 'Billable hours'],
        ...sorted.map((t) => [...t.label, hours(t.minutes), hours(t.billable)]),
        ['Total', ...head.slice(1).map(() => ''), hours(sum('minutes')), hours(sum('billable'))],
      ];
    }
    await ctx.log(
      'time.exported',
      group,
      `Exported ${firm ? 'firm' : 'own'} time grouped by ${group} for ${range.from} to ${range.to}`,
    );
    return { filename: `aeka-timesheet-${group}-${range.from}-to-${range.to}.csv`, csv: toCsv(rows) };
  },
};
