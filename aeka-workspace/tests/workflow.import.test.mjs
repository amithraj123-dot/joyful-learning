import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { firm, taskInput } from './fixtures/workflow-firm.mjs';

const json = readFileSync(new URL('./fixtures/workflow-legacy.json', import.meta.url), 'utf8');
const riya = 'riya@aeka.example';
const dev = 'dev@aeka.example';
const mapping = [
  { initials: 'RD', email: riya },
  { initials: 'DS', email: dev },
  { initials: 'GM', email: null },
];

async function setup() {
  const f = await firm();
  await f.send('admin', 'core', 'members.save', {
    member: { email: riya, name: 'Riya Desai', initials: 'RD', designation: 'Manager' },
  });
  return f;
}

test('import preview counts the legacy records and suggests members by initials', async () => {
  const { wf, ok } = await setup();
  assert.equal((await wf('manager', 'import.preview', { json })).status, 403);
  const preview = await ok('admin', 'import.preview', { json });
  assert.deepEqual(
    [
      preview.clients,
      preview.matters,
      preview.tasks,
      preview.timeEntries,
      preview.milestones,
      preview.invoices,
      preview.dealTrackers,
    ],
    [3, 3, 3, 3, 1, 2, 1],
  );
  assert.deepEqual(preview.people, [
    { initials: 'DS', name: 'Dev Sharma', designation: 'Assistant Manager', email: null },
    { initials: 'GM', name: 'Gauri Menon', designation: 'Associate', email: null },
    { initials: 'RD', name: 'Riya Desai', designation: 'Manager', email: riya },
    { initials: 'ZZ', name: '', designation: '', email: null },
  ]);
  const warnings = preview.warnings.join('\n');
  assert.match(warnings, /Initials ZZ appear in the data but not in its team roster/);
  assert.match(
    warnings,
    /The client name "vista earth group" appears more than once; it was imported as "vista earth group \(2\)"/,
  );
  assert.match(warnings, /Skipped invoice entries with no valid amount on Project Falcon \(1\)/);
  assert.match(warnings, /Skipped tasks with no text on Project Falcon \(1\)/);
  assert.match(warnings, /Skipped milestones with no title or date on Project Falcon \(1\)/);
  assert.match(warnings, /billed amount on Project Falcon differed from its invoices/);
  assert.match(warnings, /self-reflection and the reviewer's rating in one record/);

  for (const bad of ['not json', '{"error":"Script failed"}', '{"rows":[]}']) {
    const r = await wf('admin', 'import.preview', { json: bad });
    assert.equal(r.status, 400, r.error);
  }
  assert.equal((await wf('admin', 'import.preview', {})).status, 400);
});

test('import maps people, statuses, billing, tasks, time, feedback and the deal tracker, idempotently', async () => {
  const { db, wf, ok, send } = await setup();
  const run = await ok('admin', 'import.run', { json, people: mapping });
  assert.deepEqual(
    [run.clients, run.matters, run.tasks, run.timeEntries, run.milestones, run.invoices, run.dealTrackers],
    [3, 3, 3, 3, 1, 2, 1],
  );

  // A member is added for the newly mapped email, from the roster, without admin rights.
  const members = (await send('admin', 'core', 'members.list')).value;
  const added = members.find((m) => m.email === dev);
  assert.deepEqual(
    [added.name, added.initials, added.designation, added.isAdmin, added.active],
    ['Dev Sharma', 'DS', 'Assistant Manager', false, true],
  );

  const s = await ok('admin', 'snapshot');
  const matter = (id) => s.matters.find((m) => m.id === id);
  const falcon = matter('lg-p_falcon');
  assert.equal(falcon.id, 'lg-p_falcon');
  assert.equal(falcon.clientId, 'lg-c_mf3k2');
  assert.deepEqual(
    [
      falcon.status,
      falcon.stage,
      falcon.isDeal,
      falcon.priority,
      falcon.peerFeedbackVisible,
      falcon.restricted,
    ],
    ['on_hold', 'Definitive Documents', true, true, true, false],
  );
  assert.deepEqual(falcon.team, [dev, riya, 'legacy:ZZ']);
  const msop = matter('lg-p_msop');
  assert.deepEqual(
    [msop.stage, msop.isDeal, msop.team],
    ['Term Sheet and Structuring', false, ['legacy:GM']],
  );
  const lp = matter('lg-p_lp');
  assert.deepEqual([lp.status, lp.stage], ['closed', 'Post-Transaction']);
  // Names stay unique: within the data, and against clients already in the workspace.
  assert.deepEqual(
    s.clients
      .filter((c) => c.id.startsWith('lg-'))
      .map((c) => c.name)
      .sort(),
    ['Northwind Capital', 'Vista Earth Group (imported)', 'vista earth group (2)'],
  );
  assert.ok(run.warnings.some((w) => w.includes('the imported one is named "Vista Earth Group (imported)"')));

  const tasks = Object.fromEntries(s.tasks.map((t) => [t.id, t]));
  assert.deepEqual(Object.keys(tasks).sort(), ['lg-t1', 'lg-t1-2', 'lg-t2']);
  const t1 = tasks['lg-t1'];
  assert.deepEqual(
    [t1.status, t1.assignee, t1.preparedBy, t1.reviewedBy, t1.dueDate, t1.priority, t1.notes],
    ['In Review', riya, riya, dev, '2026-11-10', true, 'Focus on tax indemnity'],
  );
  assert.deepEqual(t1.steps, [
    { id: 's1', text: 'Review indemnities', done: true },
    { id: 's2', text: 'Tax warranties', done: false },
  ]);
  assert.deepEqual([tasks['lg-t2'].status, tasks['lg-t2'].assignee], ['Completed', 'legacy:ZZ']);
  assert.equal(tasks['lg-t1-2'].status, 'Completed');
  assert.deepEqual(
    s.milestones.map((m) => [m.title, m.kind, m.dueDate]),
    [['Long stop date', 'Deadline', '2026-11-30']],
  );

  const billing = Object.fromEntries(s.billing.map((b) => [b.matterId, b]));
  assert.deepEqual(
    [
      billing[falcon.id].elStatus,
      billing[falcon.id].invoiceStatus,
      billing[falcon.id].feePaise,
      billing[falcon.id].billedPaise,
    ],
    ['Fully Executed', 'Partially Invoiced', 50000000, 15000000],
  );
  assert.equal(billing[msop.id].billedPaise, 7500050);
  const opening = await ok('admin', 'invoices.list', { matterId: msop.id });
  assert.deepEqual(
    opening.map((i) => [i.invoiceNo, i.amountPaise, i.notes]),
    [['', 7500050, 'Opening balance (imported)']],
  );
  const [invoice] = await ok('admin', 'invoices.list', { matterId: falcon.id });
  assert.deepEqual(
    [invoice.invoiceNo, invoice.date, invoice.entity],
    ['AEKA/25-26/014', '2026-08-15', 'Vista Earth Private Limited'],
  );

  const time = await ok('admin', 'time.list', { from: '2026-01-01', to: '2026-12-31' });
  assert.deepEqual(
    time.map((e) => [e.matterId, e.person, e.date, e.minutes]).sort(),
    [
      ['lg-p_falcon', 'legacy:ZZ', '2026-09-02', 76],
      ['lg-p_falcon', riya, '2026-09-01', 150],
      ['lg-p_lp', 'legacy:GM', '2026-07-01', 30],
    ].sort(),
  );

  const feedback = await ok('admin', 'feedback.list', { matterId: falcon.id });
  assert.deepEqual(
    feedback.map((f) => [f.member, f.kind, f.text, f.rating, f.author]),
    [
      [riya, 'review', '', 4, dev],
      [riya, 'self', 'Handled the SPA mark-up well.', null, dev],
    ],
  );

  const deal = await ok('admin', 'deal.get', { matterId: falcon.id });
  assert.deepEqual(
    [deal.revision, deal.dealValue, deal.representing, deal.targetCompany],
    [1, 'INR 45 crore', 'Buy Side', 'Falcon Tech Private Limited'],
  );
  assert.deepEqual(
    deal.targetDocs.map((d) => [d.name, d.status]),
    [
      ['SSA', 'Finalised'],
      ['Capitalisation Table', 'Executed'],
      ['Valuation Report', 'Draft Pending'],
      ['Disclosure Letter', 'In Review'],
    ],
  );
  const parties = deal.counterparties.map((c) => [
    c.name,
    c.incomeTax,
    c.fema,
    c.docs.map((d) => `${d.name}: ${d.status}`),
  ]);
  assert.deepEqual(parties, [
    [
      'mauritius holdco',
      'Non-Resident',
      'Non-Resident',
      [
        'SPA: Comments Shared',
        'Tax CPs (s.499): In Review',
        'Tax Computation: Not Applicable',
        'Form 10F / TRC: Draft Pending',
      ],
    ],
    [
      'Seller One',
      'Resident',
      'Resident',
      ['SPA: Comments Shared', 'Capitalisation Table: Executed', 'Board resolution: In Review'],
    ],
  ]);
  // The imported tracker passes the same validation as a save from the screen.
  const resaved = await wf('admin', 'deal.save', { matterId: falcon.id, baseRevision: 1, deal });
  assert.equal(resaved.status, 200, resaved.error);

  // Imported legacy keys are valid people from now on; unknown ones are not.
  await ok('admin', 'task.create', { task: taskInput(falcon.id, { assignee: 'legacy:ZZ' }) });
  assert.equal(
    (await wf('admin', 'task.create', { task: taskInput(falcon.id, { assignee: 'legacy:QQ' }) })).status,
    400,
  );

  // Running again imports nothing new and adds no members.
  const again = await ok('admin', 'import.run', { json, people: mapping });
  assert.deepEqual(
    [
      again.clients,
      again.matters,
      again.tasks,
      again.timeEntries,
      again.milestones,
      again.invoices,
      again.dealTrackers,
    ],
    [0, 0, 0, 0, 0, 0, 0],
  );
  assert.equal((await send('admin', 'core', 'members.list')).value.length, members.length);
  const count = (table) => db.sql.prepare(`SELECT count(*) AS n FROM ${table} WHERE id LIKE 'lg-%'`).get().n;
  assert.deepEqual(
    ['wf_clients', 'wf_matters', 'wf_tasks', 'wf_time', 'wf_invoices', 'wf_feedback'].map(count),
    [3, 3, 3, 3, 2, 2],
  );
  const preview = await ok('admin', 'import.preview', { json });
  assert.match(preview.warnings[0], /imported before/);

  const activity = (await send('admin', 'core', 'activity.list', { filterModule: 'workflow' })).value;
  assert.match(
    activity.find((a) => a.action === 'import.completed').summary,
    /^Imported data from the earlier Workflow app: \d+ clients/,
  );
});

test('import mapping is validated and never reuses initials held by another member', async () => {
  const { wf } = await setup();
  const run = (people) => wf('admin', 'import.run', { json, people });
  assert.equal((await run([{ initials: 'QQ', email: null }])).status, 400);
  assert.equal((await run([{ initials: 'DS', email: 'not-an-email' }])).status, 400);
  const clash = await run([{ initials: 'RD', email: 'someone.else@aeka.example' }]);
  assert.equal(clash.status, 409);
  assert.match(clash.error, /Initials RD already belong to riya@aeka.example/);
  assert.equal((await wf('manager', 'import.run', { json, people: [] })).status, 403);
});

test('import fetches an Apps Script web app, following only redirects within Google script hosts', async (t) => {
  const { wf, ok } = await setup();
  const calls = [];
  const respond = (handler) =>
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      calls.push({ url: String(url), init });
      return handler(String(url));
    });
  const exec = 'https://script.google.com/macros/s/AKfycbx123/exec';
  respond((url) =>
    url.startsWith('https://script.google.com/')
      ? new Response(null, {
          status: 302,
          headers: { Location: 'https://script.googleusercontent.com/macros/echo?user_content_key=k' },
        })
      : new Response(json, { headers: { 'Content-Type': 'application/json' } }),
  );
  const preview = await ok('admin', 'import.preview', { url: exec });
  assert.equal(preview.clients, 3);
  assert.deepEqual(
    calls.map((c) => c.url),
    [exec, 'https://script.googleusercontent.com/macros/echo?user_content_key=k'],
  );
  for (const c of calls) {
    assert.equal(c.init.redirect, 'manual');
    assert.ok(!new Headers(c.init.headers).has('Cookie'));
    assert.ok(!new Headers(c.init.headers).has('Authorization'));
  }

  for (const url of [
    'http://script.google.com/macros/s/x/exec',
    'https://evil.example/macros/s/x',
    'https://script.google.com/a/b',
  ]) {
    const r = await wf('admin', 'import.preview', { url });
    assert.equal(r.status, 400, url);
    assert.match(r.error, /address of the Apps Script web app/);
  }
  t.mock.restoreAll();
  respond(() => new Response(null, { status: 302, headers: { Location: 'https://evil.example/data' } }));
  assert.equal((await wf('admin', 'import.preview', { url: exec })).status, 400);
  t.mock.restoreAll();
  respond(() => new Response('x'.repeat(5 * 1024 * 1024 + 1)));
  assert.equal((await wf('admin', 'import.preview', { url: exec })).status, 413);
  t.mock.restoreAll();
  respond(() => new Response('Sign in', { status: 401 }));
  assert.equal((await wf('admin', 'import.preview', { url: exec })).status, 502);
});
