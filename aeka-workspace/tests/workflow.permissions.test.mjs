import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { workflowServer } from '../modules/workflow/server/index.ts';
import { todayIST } from '../modules/workflow/shared/types.ts';
import { firm, matterInput, people, taskInput } from './fixtures/workflow-firm.mjs';

test('the server implements exactly the actions of the shared contract', () => {
  const contract = readFileSync(new URL('../modules/workflow/shared/contract.ts', import.meta.url), 'utf8');
  const start = contract.indexOf('export interface WorkflowActions');
  const block = contract.slice(start, contract.indexOf('\n}\n', start));
  const names = [...block.matchAll(/^ {2}'?([\w.]+)'?: \{/gm)].map((m) => m[1]).sort();
  assert.ok(names.length > 30);
  assert.deepEqual(Object.keys(workflowServer.actions).sort(), names);
});

test('capabilities follow the designation, and admins have every right', async () => {
  const { ok } = await firm();
  const caps = async (who) => (await ok(who, 'snapshot')).capabilities;
  const none = {
    manageMatters: false,
    viewBilling: false,
    editBilling: false,
    reviewPeople: false,
    logTimeForOthers: false,
    exportFirmTime: false,
    importData: false,
  };
  const manager = Object.fromEntries(Object.keys(none).map((k) => [k, k !== 'importData']));
  assert.deepEqual(await caps('article'), none);
  assert.deepEqual(await caps('associate'), none);
  assert.deepEqual(await caps('am'), manager);
  assert.deepEqual(await caps('director'), manager);
  assert.deepEqual(await caps('opsAdmin'), { ...manager, importData: true });
});

test('clients, matters and milestones need Manager and above; strangers are refused', async () => {
  const { wf, client, open } = await firm();
  const newClient = (who) => wf(who, 'client.create', { client: { name: 'Northwind ' + who, notes: '' } });
  assert.equal((await newClient('outsider')).status, 403);
  assert.equal((await newClient('article')).status, 403);
  assert.equal((await newClient('associate')).status, 403);
  assert.equal((await newClient('am')).status, 200);
  assert.equal((await newClient('opsAdmin')).status, 200);
  assert.equal((await wf('am', 'client.create', { client: { name: 'vista earth GROUP' } })).status, 409);
  const matter = (who) =>
    wf(who, 'matter.create', { matter: matterInput(client.id, { title: 'Structuring ' + who }) });
  assert.equal((await matter('associate')).status, 403);
  assert.equal((await matter('manager')).status, 200);
  const milestone = (who) =>
    wf(who, 'milestone.create', {
      milestone: {
        matterId: open.id,
        title: 'Long stop date',
        kind: 'Signing',
        dueDate: '2026-12-31',
        done: false,
        owner: null,
      },
    });
  assert.equal((await milestone('associate')).status, 403);
  assert.equal((await milestone('am')).status, 200);
});

test('restricted matters are invisible (404) outside the ethical wall, across every action', async () => {
  const { wf, ok, walled, open, client } = await firm();
  const insider = await ok('associate', 'task.create', { task: taskInput(walled.id) });
  const time = await ok('associate', 'time.create', {
    entry: {
      matterId: walled.id,
      person: people.associate.email,
      date: todayIST(),
      minutes: 60,
      description: '',
      billable: true,
    },
  });
  const ids = (s) => s.matters.map((m) => m.id);
  assert.deepEqual(ids(await ok('associate', 'snapshot')).sort(), [open.id, walled.id].sort());
  assert.deepEqual(ids(await ok('director', 'snapshot')).sort(), [open.id, walled.id].sort());
  const managerView = await ok('manager', 'snapshot');
  assert.deepEqual(ids(managerView), [open.id]);
  assert.ok(!managerView.tasks.some((t) => t.id === insider.id));

  const attempts = {
    'matter.update': { id: walled.id, baseRevision: 1, matter: matterInput(client.id, { title: 'Kite' }) },
    'matter.delete': { id: walled.id, baseRevision: 1 },
    'task.create': { task: taskInput(walled.id) },
    'task.update': { id: insider.id, baseRevision: 1, task: taskInput(walled.id) },
    'task.delete': { id: insider.id, baseRevision: 1 },
    'time.create': {
      entry: {
        matterId: walled.id,
        person: people.manager.email,
        date: todayIST(),
        minutes: 5,
        billable: true,
      },
    },
    'time.update': { id: time.id, entry: {} },
    'time.delete': { id: time.id },
    'time.list': { from: '2026-01-01', to: todayIST(), matterId: walled.id },
    'milestone.create': {
      milestone: { matterId: walled.id, title: 'X', kind: 'Other', dueDate: '2026-12-01', done: false },
    },
    'billing.update': { matterId: walled.id, baseRevision: 0, billing: {} },
    'invoices.list': { matterId: walled.id },
    'invoice.create': { matterId: walled.id, invoice: {} },
    'deal.get': { matterId: walled.id },
    'deal.save': { matterId: walled.id, baseRevision: 0, deal: {} },
    'feedback.list': { matterId: walled.id },
    'feedback.save': { matterId: walled.id, member: people.associate.email, kind: 'review', baseRevision: 0 },
  };
  for (const [action, payload] of Object.entries(attempts)) {
    const r = await wf('manager', action, payload);
    assert.equal(r.status, 404, `${action}: ${r.error}`);
    assert.match(r.error, /could not be found/);
  }
  // Members who are not managers get 404 too where the action is open to them.
  assert.equal((await wf('article', 'deal.get', { matterId: walled.id })).status, 404);
  assert.equal((await wf('article', 'task.create', { task: taskInput(walled.id) })).status, 404);

  // The firm export leaves out what the exporter may not see.
  const csv = (who) => ok(who, 'time.export', { from: '2026-01-01', to: todayIST(), group: 'raw' });
  assert.doesNotMatch((await csv('manager')).csv, /Project Kite/);
  assert.match((await csv('director')).csv, /Project Kite/);

  // A client whose only matters are behind a wall is hidden as well.
  const hidden = await ok('admin', 'client.create', { client: { name: 'Hidden Co' } });
  await ok('admin', 'matter.create', {
    matter: matterInput(hidden.id, { restricted: true, team: [people.director.email] }),
  });
  assert.ok(!(await ok('manager', 'snapshot')).clients.some((c) => c.id === hidden.id));
  assert.ok((await ok('partner', 'snapshot')).clients.some((c) => c.id === hidden.id));
});

test('work on a restricted matter goes only to people inside the wall', async () => {
  const { wf, ok, walled } = await firm();
  const r = await wf('associate', 'task.create', {
    task: taskInput(walled.id, { assignee: people.article.email }),
  });
  assert.equal(r.status, 400);
  assert.match(r.error, /cannot see this restricted matter/);
  // A Director sees every matter, so may be assigned without joining the team.
  await ok('associate', 'task.create', { task: taskInput(walled.id, { assignee: people.director.email }) });
});

test('billing is for Manager and above; the billed amount comes from invoices', async () => {
  const { wf, ok, open } = await firm();
  const member = await ok('associate', 'snapshot');
  assert.deepEqual(member.billing, []);
  assert.equal((await wf('associate', 'invoices.list', { matterId: open.id })).status, 403);
  assert.equal((await wf('associate', 'billing.update', { matterId: open.id, baseRevision: 0 })).status, 403);

  const before = (await ok('am', 'snapshot')).billing.find((b) => b.matterId === open.id);
  assert.deepEqual(
    { ...before },
    {
      matterId: open.id,
      elStatus: 'Not Started',
      invoiceStatus: 'Not Invoiced',
      feePaise: null,
      adminNotes: '',
      revision: 0,
      updatedAt: 0,
      billedPaise: 0,
    },
  );
  const billing = {
    elStatus: 'Fully Executed',
    invoiceStatus: 'Partially Invoiced',
    feePaise: 50000000,
    adminNotes: '',
  };
  const saved = await ok('am', 'billing.update', { matterId: open.id, baseRevision: 0, billing });
  assert.equal(saved.revision, 1);
  assert.equal(
    (await wf('am', 'billing.update', { matterId: open.id, baseRevision: 0, billing })).status,
    409,
  );
  assert.equal(
    (
      await wf('am', 'billing.update', {
        matterId: open.id,
        baseRevision: 1,
        billing: { ...billing, feePaise: -1 },
      })
    ).status,
    400,
  );

  const invoice = {
    invoiceNo: 'AEKA/26-27/014',
    date: '2026-08-15',
    amountPaise: 15000000,
    entity: '',
    notes: '',
  };
  assert.equal(
    (await wf('am', 'invoice.create', { matterId: open.id, invoice: { ...invoice, amountPaise: 0 } })).status,
    400,
  );
  const created = await ok('am', 'invoice.create', { matterId: open.id, invoice });
  assert.equal(
    (
      await wf('am', 'invoice.create', {
        matterId: open.id,
        invoice: { ...invoice, invoiceNo: 'aeka/26-27/014' },
      })
    ).status,
    409,
  );
  await ok('am', 'invoice.create', {
    matterId: open.id,
    invoice: { ...invoice, invoiceNo: '', amountPaise: 2500 },
  });
  const billed = async () =>
    (await ok('am', 'snapshot')).billing.find((b) => b.matterId === open.id).billedPaise;
  assert.equal(await billed(), 15002500);
  await ok('am', 'invoice.delete', { id: created.id });
  assert.equal(await billed(), 2500);
  assert.equal((await ok('am', 'invoices.list', { matterId: open.id })).length, 1);
});

test('task rights: any member who can see the matter creates; editing and deleting are narrower', async () => {
  const { wf, ok, open } = await firm();
  // The associate is on the team; the article is not.
  const task = await ok('associate', 'task.create', { task: taskInput(open.id) });
  const edit = (who, over = {}, base = task.revision) =>
    wf(who, 'task.update', { id: task.id, baseRevision: base, task: taskInput(open.id, over) });
  const r = await edit('article', { notes: 'x' });
  assert.equal(r.status, 403);
  assert.match(r.error, /tasks assigned to you/);
  const assigned = (await edit('associate', { assignee: people.article.email })).value;
  const byArticle = await wf('article', 'task.update', {
    id: task.id,
    baseRevision: assigned.revision,
    task: taskInput(open.id, { assignee: people.article.email, status: 'In Review' }),
  });
  assert.equal(byArticle.status, 200);
  const del = (who) => wf(who, 'task.delete', { id: task.id, baseRevision: byArticle.value.revision });
  assert.equal((await del('article')).status, 403);
  const own = await ok('article', 'task.create', {
    task: taskInput(open.id, { title: 'Collect cap table' }),
  });
  assert.equal((await wf('article', 'task.delete', { id: own.id, baseRevision: 1 })).status, 200);
  assert.equal((await del('am')).status, 200);
  assert.equal((await wf('article', 'task.restore', { id: task.id })).status, 403);
  assert.equal((await wf('manager', 'task.restore', { id: task.id })).status, 200);
});
