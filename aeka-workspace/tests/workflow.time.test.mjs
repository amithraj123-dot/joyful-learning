import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell } from '../modules/workflow/server/export.ts';
import { todayIST } from '../modules/workflow/shared/types.ts';
import { firm, people } from './fixtures/workflow-firm.mjs';

const today = todayIST();
const daysAgo = (n) => new Date(Date.parse(today) - n * 86400000).toISOString().slice(0, 10);
const entry = (matterId, person, over = {}) => ({
  matterId,
  person: people[person].email,
  date: today,
  minutes: 90,
  description: 'Reviewed the SPA',
  billable: true,
  ...over,
});

test('members record and see their own time; Manager and above also others', async () => {
  const { wf, ok, open } = await firm();
  await ok('article', 'time.create', { entry: entry(open.id, 'article') });
  const forOther = await wf('article', 'time.create', { entry: entry(open.id, 'associate') });
  assert.equal(forOther.status, 403);
  assert.match(forOther.error, /Only a Manager or above can record time for someone else/);
  const other = await ok('manager', 'time.create', { entry: entry(open.id, 'associate', { minutes: 30 }) });
  assert.equal(other.createdBy, people.manager.email);

  const range = { from: daysAgo(7), to: today };
  assert.deepEqual(
    (await ok('article', 'time.list', range)).map((e) => e.person),
    [people.article.email],
  );
  assert.equal((await wf('article', 'time.list', { ...range, person: people.associate.email })).status, 403);
  assert.equal((await ok('manager', 'time.list', range)).length, 2);
  assert.equal((await ok('manager', 'time.list', { ...range, person: people.associate.email })).length, 1);
  assert.equal(
    (await wf('article', 'time.update', { id: other.id, entry: entry(open.id, 'associate') })).status,
    403,
  );
  assert.equal((await wf('article', 'time.delete', { id: other.id })).status, 403);
  assert.equal((await wf('am', 'time.delete', { id: other.id })).status, 200);
  assert.equal((await wf('manager', 'time.list', { from: today, to: daysAgo(1) })).status, 400);
});

test('time entries are capped at 24 hours a day and cannot be in the future', async () => {
  const { wf, ok, open } = await firm();
  const create = (over) => wf('associate', 'time.create', { entry: entry(open.id, 'associate', over) });
  assert.equal((await create({ minutes: 0 })).status, 400);
  assert.equal((await create({ minutes: 1441 })).status, 400);
  assert.equal((await create({ minutes: 1.5 })).status, 400);
  assert.equal((await create({ description: 'x'.repeat(501) })).status, 400);
  assert.equal((await create({ date: '2026-02-29' })).status, 400);
  const future = await create({ date: new Date(Date.parse(today) + 86400000).toISOString().slice(0, 10) });
  assert.equal(future.status, 400);
  assert.match(future.error, /future date/);
  const first = await ok('associate', 'time.create', {
    entry: entry(open.id, 'associate', { minutes: 1000 }),
  });
  const over = await create({ minutes: 441 });
  assert.equal(over.status, 400);
  assert.match(over.error, /more than 24 hours for Asha Verma/);
  assert.equal((await create({ minutes: 440 })).status, 200);
  // An edit is checked without counting the entry being edited.
  await ok('associate', 'time.update', {
    id: first.id,
    entry: entry(open.id, 'associate', { minutes: 1000 }),
  });
  assert.equal((await create({ minutes: 1, date: daysAgo(1) })).status, 200);
});

test('owners may change an entry for 30 days after recording it', async () => {
  const { db, wf, ok, open } = await firm();
  const mine = await ok('article', 'time.create', {
    entry: entry(open.id, 'article', { date: daysAgo(40) }),
  });
  await ok('article', 'time.update', {
    id: mine.id,
    entry: entry(open.id, 'article', { minutes: 60, date: daysAgo(40) }),
  });
  db.sql.prepare('UPDATE wf_time SET created_at = ? WHERE id = ?').run(Date.now() - 31 * 86400000, mine.id);
  const late = await wf('article', 'time.update', { id: mine.id, entry: entry(open.id, 'article') });
  assert.equal(late.status, 403);
  assert.match(late.error, /30 days/);
  assert.equal((await wf('article', 'time.delete', { id: mine.id })).status, 403);
  const fixed = await ok('manager', 'time.update', {
    id: mine.id,
    entry: entry(open.id, 'article', { minutes: 45 }),
  });
  assert.equal(fixed.minutes, 45);
});

test('CSV cells are quoted and cannot run as spreadsheet formulas', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('=SUM(A1:A9)'), "'=SUM(A1:A9)");
  assert.equal(csvCell('+91 98'), "'+91 98");
  assert.equal(csvCell('-2'), "'-2");
  assert.equal(csvCell('@cmd'), "'@cmd");
  assert.equal(csvCell('\tx'), "'\tx");
  assert.equal(csvCell('\rx'), `"'\rx"`);
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=HYPERLINK("http://x","y")'), `"'=HYPERLINK(""http://x"",""y"")"`);
  assert.equal(csvCell('line\nbreak'), '"line\nbreak"');
});

test('the timesheet export has a BOM, CRLF lines, names, groupings and totals', async () => {
  const { ok, client, open } = await firm();
  await ok('associate', 'time.create', {
    entry: entry(open.id, 'associate', { minutes: 150, description: '=cmd|" /C calc"!A0', date: daysAgo(2) }),
  });
  await ok('manager', 'time.create', { entry: entry(open.id, 'manager', { minutes: 45, billable: false }) });
  await ok('associate', 'time.create', {
    entry: entry(open.id, 'associate', { minutes: 20, description: 'Call, follow-up' }),
  });
  const range = { from: daysAgo(30), to: today };

  const raw = await ok('manager', 'time.export', { ...range, group: 'raw' });
  assert.equal(raw.filename, `aeka-timesheet-raw-${range.from}-to-${today}.csv`);
  assert.ok(
    raw.csv.startsWith('﻿Client,Mandate,Type,Person name,Initials,Date,Hours,Billable,Description\r\n'),
  );
  assert.ok(raw.csv.endsWith('\r\n'));
  assert.ok(!/[^\r]\n/.test(raw.csv));
  const lines = raw.csv.slice(1).trimEnd().split('\r\n');
  assert.equal(lines.length, 4);
  assert.equal(
    lines[1],
    `Vista Earth Group,Project Falcon,Deal (Buy Side),Asha Verma,AV,${daysAgo(2)},2.50,Yes,"'=cmd|"" /C calc""!A0"`,
  );
  assert.ok(
    lines.includes(
      `Vista Earth Group,Project Falcon,Deal (Buy Side),Mona Iyer,MI,${today},0.75,No,Reviewed the SPA`,
    ),
  );
  assert.ok(
    lines.includes(
      `Vista Earth Group,Project Falcon,Deal (Buy Side),Asha Verma,AV,${today},0.33,Yes,"Call, follow-up"`,
    ),
  );

  const byPerson = await ok('manager', 'time.export', { ...range, group: 'person' });
  assert.equal(
    byPerson.csv,
    '﻿Person name,Initials,Hours,Billable hours\r\nAsha Verma,AV,2.83,2.83\r\nMona Iyer,MI,0.75,0.00\r\nTotal,,3.58,2.83\r\n',
  );
  const byMatter = await ok('manager', 'time.export', { ...range, group: 'matter', clientId: client.id });
  assert.equal(
    byMatter.csv,
    '﻿Client,Mandate,Type,Hours,Billable hours\r\nVista Earth Group,Project Falcon,Deal (Buy Side),3.58,2.83\r\nTotal,,,3.58,2.83\r\n',
  );
  const byClient = await ok('manager', 'time.export', { ...range, group: 'client' });
  assert.match(byClient.csv, /\r\nVista Earth Group,3\.58,2\.83\r\nTotal,3\.58,2\.83\r\n$/);

  // Members export only their own time.
  const own = await ok('associate', 'time.export', { ...range, group: 'person' });
  assert.doesNotMatch(own.csv, /Mona Iyer/);
  assert.match(own.csv, /Asha Verma,AV,2\.83/);
});
