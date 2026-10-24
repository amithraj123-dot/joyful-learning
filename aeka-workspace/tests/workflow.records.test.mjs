import test from 'node:test';
import assert from 'node:assert/strict';
import { firm, matterInput, people, taskInput } from './fixtures/workflow-firm.mjs';

test('saves are checked against the revision the editor read (409 on a stale revision)', async () => {
  const { wf, ok, client, open } = await firm();
  const renamed = await ok('am', 'client.update', {
    id: client.id,
    baseRevision: 1,
    client: { name: 'Vista Earth Holdings', notes: '' },
  });
  assert.equal(renamed.revision, 2);
  const stale = await wf('manager', 'client.update', {
    id: client.id,
    baseRevision: 1,
    client: { name: 'Vista', notes: '' },
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.error, 'This client changed since you opened it. Reload and try again.');

  const input = matterInput(client.id, { team: open.team });
  await ok('am', 'matter.update', {
    id: open.id,
    baseRevision: 1,
    matter: { ...input, stage: 'Signing and Closing' },
  });
  assert.equal(
    (await wf('am', 'matter.update', { id: open.id, baseRevision: 1, matter: input })).status,
    409,
  );
  assert.equal((await wf('am', 'matter.delete', { id: open.id, baseRevision: 1 })).status, 409);

  const task = await ok('associate', 'task.create', { task: taskInput(open.id) });
  await ok('associate', 'task.update', {
    id: task.id,
    baseRevision: 1,
    task: taskInput(open.id, { notes: 'a' }),
  });
  const late = await wf('manager', 'task.update', { id: task.id, baseRevision: 1, task: taskInput(open.id) });
  assert.equal(late.status, 409);
  assert.match(late.error, /^This task changed since you opened it/);
});

test('inputs are validated strictly', async () => {
  const { wf, send, client, open } = await firm();
  const bad = async (action, payload, pattern) => {
    const r = await wf('admin', action, payload);
    assert.equal(r.status, 400, `${action}: ${r.error}`);
    if (pattern) assert.match(r.error, pattern);
  };
  await bad('client.create', { client: { name: '   ' } }, /Enter the client name/);
  await bad('client.create', { client: { name: 'x'.repeat(201) } }, /200 characters or fewer/);
  await bad('matter.create', { matter: matterInput(client.id, { status: 'onhold' }) }, /valid status/);
  await bad(
    'matter.create',
    { matter: matterInput(client.id, { team: ['nobody@aeka.example'] }) },
    /active firm member/,
  );
  await bad(
    'matter.create',
    { matter: matterInput(client.id, { team: ['legacy:QQ'] }) },
    /active firm member/,
  );
  await bad('matter.create', { matter: matterInput(client.id, { priority: 'yes' }) });
  await bad('task.create', { task: taskInput(open.id, { dueDate: '2026-02-30' }) }, /valid date/);
  await bad('task.create', { task: taskInput(open.id, { status: 'Done' }) });
  await bad('task.create', {
    task: taskInput(open.id, {
      steps: [
        { id: 'a', text: 'x', done: false },
        { id: 'a', text: 'y', done: false },
      ],
    }),
  });
  await bad('task.create', {
    task: taskInput(open.id, {
      steps: Array.from({ length: 101 }, (_, i) => ({ id: 's' + i, text: 'x', done: false })),
    }),
  });
  await bad('task.create', { task: taskInput(open.id, { assignee: 'Not an email' }) });
  await bad('milestone.create', {
    milestone: { matterId: open.id, title: 'X', kind: 'Party', dueDate: '2026-12-01', done: false },
  });
  // A deactivated member cannot be newly assigned, but stays valid where already named.
  const kept = await wf('admin', 'matter.update', {
    id: open.id,
    baseRevision: 1,
    matter: matterInput(client.id, { team: [...open.team, people.article.email] }),
  });
  assert.equal(kept.status, 200);
  await send('admin', 'core', 'members.deactivate', { email: people.article.email });
  await bad(
    'task.create',
    { task: taskInput(open.id, { assignee: people.article.email }) },
    /active firm member/,
  );
  const note = await wf('admin', 'matter.update', {
    id: open.id,
    baseRevision: 2,
    matter: matterInput(client.id, { team: kept.value.team, note: 'Signing next week' }),
  });
  assert.equal(note.status, 200);
});

test('maker-checker: a prepared task needs a different reviewer before it goes to the client', async () => {
  const { wf, ok, open } = await firm();
  const prepared = { preparedBy: people.associate.email };
  const refused = await wf('associate', 'task.create', {
    task: taskInput(open.id, { ...prepared, status: 'Completed' }),
  });
  assert.equal(refused.status, 400);
  assert.match(refused.error, /reviewed by someone other than its preparer/);
  const self = await wf('associate', 'task.create', {
    task: taskInput(open.id, { ...prepared, reviewedBy: people.associate.email, status: 'Sent to Client' }),
  });
  assert.equal(self.status, 400);

  const task = await ok('associate', 'task.create', {
    task: taskInput(open.id, { ...prepared, status: 'In Review' }),
  });
  assert.equal(task.reviewedAt, null);
  const reviewed = await ok('manager', 'task.update', {
    id: task.id,
    baseRevision: 1,
    task: taskInput(open.id, { ...prepared, reviewedBy: people.manager.email, status: 'Completed' }),
  });
  assert.equal(reviewed.status, 'Completed');
  assert.ok(reviewed.reviewedAt > 0);
  // "done" is the Completed status; there is no separate flag to drift out of step.
  assert.ok(!('done' in reviewed));
  const reopened = await ok('manager', 'task.update', {
    id: task.id,
    baseRevision: 2,
    task: taskInput(open.id, {
      ...prepared,
      reviewedBy: people.manager.email,
      status: 'Preparing',
      done: true,
    }),
  });
  assert.equal(reopened.status, 'Preparing');
  assert.equal(reopened.reviewedAt, reviewed.reviewedAt);
  const cleared = await ok('manager', 'task.update', {
    id: task.id,
    baseRevision: 3,
    task: taskInput(open.id, { ...prepared }),
  });
  assert.equal(cleared.reviewedAt, null);
  // A task with no preparer can be completed directly.
  await ok('article', 'task.create', { task: taskInput(open.id, { status: 'Completed' }) });
});

test('assigning a task never adds the person to the matter team', async () => {
  const { ok, open } = await firm();
  await ok('associate', 'task.create', {
    task: taskInput(open.id, { assignee: people.article.email, preparedBy: people.am.email }),
  });
  const matter = (await ok('admin', 'snapshot')).matters.find((m) => m.id === open.id);
  assert.deepEqual(matter.team, [people.associate.email, people.manager.email]);
  assert.equal(matter.revision, 1);
});

test('deletes are soft and restorable; deleting a client hides its matters', async () => {
  const { wf, ok, client, open } = await firm();
  const task = await ok('article', 'task.create', { task: taskInput(open.id) });
  await ok('article', 'task.delete', { id: task.id, baseRevision: 1 });
  assert.ok(!(await ok('article', 'snapshot')).tasks.some((t) => t.id === task.id));
  assert.deepEqual(
    (await ok('article', 'trash')).tasks.map((t) => t.id),
    [task.id],
  );
  assert.deepEqual((await ok('associate', 'trash')).tasks, []);
  const restored = await ok('article', 'task.restore', { id: task.id });
  assert.equal(restored.deletedAt, null);
  assert.equal(restored.revision, 3);

  await ok('am', 'client.delete', { id: client.id, baseRevision: 1 });
  const hidden = await ok('am', 'snapshot');
  assert.deepEqual([hidden.clients, hidden.matters, hidden.tasks], [[], [], []]);
  assert.equal((await wf('associate', 'task.create', { task: taskInput(open.id) })).status, 404);
  assert.deepEqual(
    (await ok('am', 'trash')).clients.map((c) => c.id),
    [client.id],
  );
  await ok('am', 'client.restore', { id: client.id });
  const back = await ok('am', 'snapshot');
  assert.deepEqual(
    back.matters.map((m) => m.id),
    [open.id],
  );
  assert.ok(back.tasks.some((t) => t.id === task.id));

  await ok('am', 'matter.delete', { id: open.id, baseRevision: 1 });
  await ok('am', 'client.delete', { id: client.id, baseRevision: 3 });
  const blocked = await wf('am', 'matter.restore', { id: open.id });
  assert.equal(blocked.status, 409);
  assert.match(blocked.error, /Restore the client/);
  await ok('am', 'client.restore', { id: client.id });
  assert.equal((await ok('am', 'matter.restore', { id: open.id })).deletedAt, null);
  assert.equal((await wf('article', 'trash')).value.clients.length, 0);
});

test('the version changes after every write, including deletes', async () => {
  const { ok, open } = await firm();
  const version = async () => (await ok('article', 'version')).version;
  const v1 = await version();
  assert.ok(v1 > 0);
  assert.equal((await ok('article', 'snapshot')).version, v1);
  const task = await ok('article', 'task.create', { task: taskInput(open.id) });
  const v2 = await version();
  assert.ok(v2 > v1);
  await ok('article', 'task.delete', { id: task.id, baseRevision: 1 });
  const v3 = await version();
  assert.ok(v3 > v2);
  const milestone = await ok('am', 'milestone.create', {
    milestone: {
      matterId: open.id,
      title: 'Board meeting',
      kind: 'Client Meeting',
      dueDate: '2026-11-05',
      done: false,
      owner: null,
    },
  });
  await ok('am', 'milestone.delete', { id: milestone.id });
  assert.ok((await version()) > v3 + 1);
});

test('the deal tracker starts from defaults and is validated as a whole', async () => {
  const { wf, ok, open } = await firm();
  const initial = await ok('article', 'deal.get', { matterId: open.id });
  assert.equal(initial.revision, 0);
  assert.deepEqual(
    initial.targetDocs.map((d) => [d.name, d.status]),
    [
      ['SSA', 'Draft Pending'],
      ['Capitalisation Table', 'Draft Pending'],
      ['Valuation Report', 'Draft Pending'],
    ],
  );
  const party = (id, name, over = {}) => ({
    id,
    name,
    incomeTax: 'Non-Resident',
    fema: 'Resident',
    docs: [{ id: id + '-spa', name: 'SPA', status: 'Comments Shared', notes: '' }],
    ...over,
  });
  const deal = {
    dealValue: 'INR 45 crore',
    representing: 'Buy Side',
    targetCompany: 'Falcon Tech Private Limited',
    targetDocs: initial.targetDocs,
    counterparties: [party('p1', 'Mauritius Holdco')],
  };
  const save = (who, d, baseRevision = 0) =>
    wf(who, 'deal.save', { matterId: open.id, baseRevision, deal: d });
  assert.equal((await save('article', deal)).status, 403);
  const saved = await save('associate', deal);
  assert.equal(saved.status, 200);
  assert.equal(saved.value.revision, 1);
  assert.equal((await save('manager', deal)).status, 409);
  assert.deepEqual(
    (await ok('article', 'deal.get', { matterId: open.id })).counterparties,
    deal.counterparties,
  );

  const invalid = [
    { ...deal, representing: 'Both' },
    { ...deal, counterparties: [party('p1', 'Seller'), party('p2', 'SELLER')] },
    { ...deal, counterparties: [party('p1', 'A'), party('p1', 'B')] },
    { ...deal, counterparties: [party('p1', 'A', { fema: 'Foreign' })] },
    { ...deal, targetDocs: [{ id: 't1', name: 'SSA', status: 'Draft pending', notes: '' }] },
    { ...deal, targetDocs: [{ id: 'bad id!', name: 'SSA', status: 'Executed', notes: '' }] },
    {
      ...deal,
      targetDocs: Array.from({ length: 51 }, (_, i) => ({
        id: 'd' + i,
        name: 'Doc ' + i,
        status: 'Executed',
        notes: '',
      })),
    },
    { ...deal, counterparties: Array.from({ length: 101 }, (_, i) => party('c' + i, 'Party ' + i)) },
  ];
  for (const d of invalid)
    assert.equal((await save('manager', d, 1)).status, 400, JSON.stringify(d).slice(0, 80));
});

test('feedback keeps self-reflections and reviews apart, with visibility rules', async () => {
  const { wf, ok, client, open } = await firm();
  const save = (who, member, kind, extra = {}) =>
    wf(who, 'feedback.save', {
      matterId: open.id,
      member,
      kind,
      text: '',
      rating: null,
      baseRevision: 0,
      ...extra,
    });
  const asha = people.associate.email;
  const mona = people.manager.email;
  assert.equal((await save('associate', asha, 'self', { text: 'Led the diligence calls' })).status, 200);
  assert.equal((await save('associate', mona, 'self', { text: 'x' })).status, 403);
  assert.equal((await save('associate', asha, 'self', { rating: 5, baseRevision: 1 })).status, 400);
  assert.equal((await save('associate', mona, 'review', { rating: 3 })).status, 403);
  assert.equal((await save('manager', mona, 'review', { rating: 5 })).status, 403);
  assert.equal((await save('manager', asha, 'review', { rating: 6 })).status, 400);
  assert.equal((await save('manager', people.article.email, 'review', { rating: 4 })).status, 400);
  const review = await save('manager', asha, 'review', { text: 'Strong drafting', rating: 4 });
  assert.equal(review.status, 200);
  assert.equal(review.value.author, mona);
  assert.equal((await save('director', asha, 'review', { rating: 5 })).status, 409);
  await ok('manager', 'feedback.save', {
    matterId: open.id,
    member: mona,
    kind: 'self',
    text: 'Ran the closing',
    rating: null,
    baseRevision: 0,
  });
  await ok('director', 'feedback.save', {
    matterId: open.id,
    member: mona,
    kind: 'review',
    text: 'Good',
    rating: 4,
    baseRevision: 0,
  });

  const seen = async (who) =>
    (await ok(who, 'feedback.list', { matterId: open.id }))
      .map((f) => `${f.member.split('@')[0]}:${f.kind}`)
      .sort();
  assert.deepEqual(await seen('associate'), ['asha:review', 'asha:self']);
  assert.deepEqual(await seen('article'), []);
  assert.deepEqual(await seen('am'), ['asha:review', 'asha:self', 'mona:review', 'mona:self']);

  await ok('manager', 'matter.update', {
    id: open.id,
    baseRevision: 1,
    matter: matterInput(client.id, { team: open.team, peerFeedbackVisible: true }),
  });
  // Peers now read each other's self-reflections, never each other's reviews.
  assert.deepEqual(await seen('associate'), ['asha:review', 'asha:self', 'mona:self']);
  assert.deepEqual(await seen('article'), []);
});
