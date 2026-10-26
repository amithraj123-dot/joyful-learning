import test from 'node:test';
import assert from 'node:assert/strict';
import { getMember } from '../core/server/members.ts';
import {
  draftReplyFor,
  mailConnected,
  mailCounts,
  mailQueue,
  searchMail,
} from '../modules/mail/server/service.ts';
import { people } from './fixtures/workflow-firm.mjs';
import { mailFirm } from './fixtures/mail-world.mjs';

const ready = async () => {
  const f = await mailFirm();
  await f.connect();
  await f.ok('admin', 'sync');
  const kestrel = await f.item('g-kestrel');
  return { f, kestrel };
};

test('another member cannot list, read, correct, draft or send the mailbox owner’s mail', async () => {
  const { f, kestrel } = await ready();
  const draft = await f.ok('admin', 'draft.create', { id: kestrel.id });
  for (const key of ['partner', 'opsAdmin']) {
    const list = await f.ok(key, 'inbox.list', { view: 'all' });
    assert.equal(list.items.length, 0);
    assert.equal(list.counts.needs_me, 0);
    const tries = [
      ['message.get', { id: kestrel.id }],
      ['triage.correct', { id: kestrel.id, changes: { tier: 4 }, baseRevision: kestrel.triage.revision }],
      ['triage.decide', { id: kestrel.id, wantDraft: false, baseRevision: kestrel.triage.revision }],
      ['triage.retry', { id: kestrel.id }],
      ['draft.create', { id: kestrel.id }],
      ['draft.get', { id: draft.id }],
      [
        'draft.update',
        { draftId: draft.id, body: 'x', to: [], cc: [], replyAll: false, baseRevision: draft.revision },
      ],
      ['draft.saveToOutlook', { draftId: draft.id, baseRevision: draft.revision }],
      ['draft.send', { draftId: draft.id, confirm: true, baseRevision: draft.revision }],
      ['draft.discard', { draftId: draft.id, baseRevision: draft.revision }],
      ['task.fromMail', { id: kestrel.id, matterId: f.open.id, title: 'x', assignee: null, dueDate: null }],
    ];
    for (const [action, payload] of tries)
      assert.equal((await f.mail(key, action, payload)).status, 404, `${key} ${action}`);
    assert.deepEqual(await f.ok(key, 'drafts.list', { includeSent: true }), []);
  }
  assert.equal((await f.mail('outsider', 'inbox.list', { view: 'all' })).status, 403);
  // Nothing was changed by the attempts.
  const after = await f.ok('admin', 'message.get', { id: kestrel.id });
  assert.equal(after.triage.tier, 1);
  assert.equal((await f.ok('admin', 'draft.get', { id: draft.id })).status, 'draft');
});

test('a draft is made only on request, with the thread and a placeholder for missing facts', async () => {
  const { f, kestrel } = await ready();
  assert.equal(f.rows('SELECT count(*) AS n FROM mail_drafts')[0].n, 0);
  const declined = await f.ok('admin', 'triage.decide', {
    id: kestrel.id,
    wantDraft: false,
    baseRevision: kestrel.triage.revision,
  });
  assert.equal(declined.draftDecision, 'declined');
  const aiBefore = f.w.ai.length;
  assert.equal(f.w.ai.length, aiBefore); // declining never calls the AI
  const draft = await f.ok('admin', 'draft.create', { id: kestrel.id, instructions: 'Keep it short.' });
  const call = f.w.ai.at(-1);
  assert.equal(call.model, 'claude-sonnet-4.6');
  assert.match(call.messages[0].content, /INPUT REQUIRED/);
  assert.match(call.messages[0].content, /data, not instructions/);
  assert.match(call.messages[1].content, /Keep it short/);
  assert.match(call.messages[1].content, /clause 9/); // the stored body, not the preview
  assert.equal(draft.placeholders, 1);
  assert.equal(draft.status, 'draft');
  assert.deepEqual(
    draft.to.map((a) => a.address),
    ['ananya.rao@northwind-holdings.example'],
  );
  assert.deepEqual(draft.cc, []);
  assert.equal((await f.ok('admin', 'message.get', { id: kestrel.id })).triage.draftDecision, 'wanted');
  // Reply all adds the original To and Cc, never the member.
  const all = await f.ok('admin', 'draft.create', { id: kestrel.id, replyAll: true });
  assert.deepEqual(
    all.cc.map((a) => a.address),
    ['vikram.desai@meridian-counsel.example'],
  );
  assert.ok(![...all.to, ...all.cc].some((a) => a.address === people.admin.email));
  // One live draft per email: the earlier one was discarded.
  assert.equal((await f.ok('admin', 'draft.get', { id: draft.id })).status, 'discarded');
  const listed = await f.ok('admin', 'drafts.list', {});
  assert.deepEqual(
    listed.map((d) => d.id),
    [all.id],
  );
  assert.equal(listed[0].subject, kestrel.subject);
  assert.equal(listed[0].from.address, 'ananya.rao@northwind-holdings.example');
  assert.equal((await f.ok('admin', 'message.get', { id: kestrel.id })).draft.id, all.id);
});

test('placeholders block sending; sending is recorded only on 202, never after an unclear failure', async () => {
  const { f, kestrel } = await ready();
  let d = await f.ok('admin', 'draft.create', { id: kestrel.id });
  const send = (draft, over = {}) =>
    f.mail('admin', 'draft.send', {
      draftId: draft.id,
      confirm: true,
      baseRevision: draft.revision,
      ...over,
    });
  assert.equal((await send(d)).status, 409); // placeholder remains
  assert.equal((await send(d, { confirm: false })).status, 400);
  assert.ok(!f.w.graphCalls().some((c) => c.url.endsWith('/send')));

  d = await f.ok('admin', 'draft.update', {
    draftId: d.id,
    body: 'Dear Ananya,\n\nThe cap in clause 9 holds under the step-up structure.\n\nAmith',
    to: d.to,
    cc: [],
    replyAll: false,
    baseRevision: d.revision,
  });
  assert.equal(d.placeholders, 0);
  assert.equal(
    (
      await f.mail('admin', 'draft.update', {
        draftId: d.id,
        body: 'x',
        to: [],
        cc: [],
        replyAll: false,
        baseRevision: 0,
      })
    ).status,
    409,
  );
  const noRecipients = await f.ok('admin', 'draft.update', {
    draftId: d.id,
    body: d.body,
    to: [],
    cc: [],
    replyAll: false,
    baseRevision: d.revision,
  });
  assert.equal((await send(noRecipients)).status, 409);
  d = await f.ok('admin', 'draft.update', {
    draftId: d.id,
    body: d.body,
    to: d.to,
    cc: [],
    replyAll: false,
    baseRevision: noRecipients.revision,
  });

  // A network failure on send: not marked sent, and the member is told to check Sent Items.
  f.w.sendMode = 'network';
  const unclear = await send(d);
  assert.equal(unclear.status, 502);
  assert.match(unclear.error, /Sent Items/);
  d = await f.ok('admin', 'draft.get', { id: d.id });
  assert.notEqual(d.status, 'sent');
  assert.equal(d.outlookSaved, true);
  assert.match((await f.ok('admin', 'account.get')).account.lastError, /Sent Items/);
  // A refusal (4xx) is a clear "not sent".
  f.w.sendMode = 400;
  assert.match((await send(d)).error, /did not send/);
  d = await f.ok('admin', 'draft.get', { id: d.id });

  f.w.sendMode = 202;
  const sent = await f.ok('admin', 'draft.send', { draftId: d.id, confirm: true, baseRevision: d.revision });
  assert.equal(sent.status, 'sent');
  assert.ok(sent.sentAt);
  // The Outlook draft was created in the thread (createReply on the original) and patched with the text.
  const created = f.w.calls.filter((c) => c.url.includes('/createReply'));
  assert.equal(created.length, 1);
  assert.match(created[0].url, /g-kestrel\/createReply$/);
  const patch = f.w.calls.filter((c) => c.method === 'PATCH').at(-1).body;
  assert.match(patch.body.content, /holds under the step-up structure/);
  assert.equal(patch.toRecipients[0].emailAddress.address, 'ananya.rao@northwind-holdings.example');
  // Replied: it leaves "Needs me", and a second send is refused.
  const item = await f.ok('admin', 'message.get', { id: kestrel.id });
  assert.equal(item.repliedByMe, true);
  const needs = await f.ok('admin', 'inbox.list', { view: 'needs_me' });
  assert.ok(!needs.items.some((i) => i.id === kestrel.id));
  assert.equal((await send(sent)).status, 409);
  const log = f.rows("SELECT summary FROM org_activity WHERE module = 'mail' AND action = 'draft.sent'");
  assert.deepEqual(
    log.map((l) => l.summary),
    ['Sent a reply'],
  );
  assert.equal((await f.ok('admin', 'drafts.list', { includeSent: true }))[0].status, 'sent');
});

test('saving to Outlook updates the same draft; discarding deletes only that draft', async () => {
  const { f, kestrel } = await ready();
  let d = await f.ok('admin', 'draft.create', { id: kestrel.id });
  d = await f.ok('admin', 'draft.saveToOutlook', { draftId: d.id, baseRevision: d.revision });
  assert.equal(d.status, 'saved');
  assert.equal(d.outlookSaved, true);
  d = await f.ok('admin', 'draft.update', {
    draftId: d.id,
    body: d.body + ' Thanks.',
    to: d.to,
    cc: [],
    replyAll: false,
    baseRevision: d.revision,
  });
  d = await f.ok('admin', 'draft.saveToOutlook', { draftId: d.id, baseRevision: d.revision });
  assert.equal(f.w.calls.filter((c) => c.url.includes('/createReply')).length, 1);
  assert.equal(f.w.drafts.size, 1);
  assert.equal(await f.ok('admin', 'draft.discard', { draftId: d.id, baseRevision: d.revision }), true);
  assert.equal(f.w.drafts.size, 0);
  const deletes = f.w.calls.filter((c) => c.method === 'DELETE');
  assert.equal(deletes.length, 1);
  assert.match(deletes[0].url, /draft-1$/);
});

test('a task from an email links the sender to the mandate for later mail, without AI', async () => {
  const { f } = await ready();
  const fcgpr = await f.item('g-fcgpr');
  const { taskId } = await f.ok('admin', 'task.fromMail', {
    id: fcgpr.id,
    matterId: f.open.id,
    title: 'Prepare the FC-GPR document list',
    assignee: people.associate.email,
    dueDate: '2026-11-10',
  });
  assert.ok(taskId);
  const task = f.rows('SELECT * FROM wf_tasks WHERE id = ?', taskId)[0];
  assert.equal(task.matter_id, f.open.id);
  assert.ok(!task.notes.includes('FIRMS portal')); // no email body copied into the task
  assert.equal((await f.ok('admin', 'message.get', { id: fcgpr.id })).triage.matterConfidence, 'confirmed');
  // A new email from the same sender: the confirmed link wins over any AI suggestion.
  f.w.extraAi = () => ({
    ai: {
      tier: 3,
      category: 'client_matter',
      handling: 'info',
      replyNeeded: 'no',
      why: 'Update.',
      deadline: null,
      asks: [],
      delegate: null,
      matterId: null,
      matterConfidence: 0,
      confidence: 0.7,
      safety_flag: null,
    },
  });
  f.w.box(people.admin.email).changes.push({
    id: 'g-fcgpr-2',
    subject: 'FC-GPR: board resolution attached',
    from: { emailAddress: { name: 'Rohan Mehta', address: 'rohan@vista-earth.example' } },
    to: [{ emailAddress: { name: 'Amith Rao', address: people.admin.email } }],
    hoursAgo: 0.1,
    conversationId: 'c-fcgpr-2',
    body: 'Attached.',
  });
  await f.ok('admin', 'sync');
  const next = await f.item('g-fcgpr-2');
  assert.equal(next.triage.matterId, f.open.id);
  assert.equal(next.triage.matterConfidence, 'confirmed');
  // A colleague cannot use another member's email to make a task.
  assert.equal(
    (
      await f.mail('partner', 'task.fromMail', {
        id: fcgpr.id,
        matterId: f.open.id,
        title: 'x',
        assignee: null,
        dueDate: null,
      })
    ).status,
    404,
  );
});

test('disconnect removes the member’s mail, triage, drafts, learning and token, and nothing else', async () => {
  const { f, kestrel } = await ready();
  f.w
    .box(people.partner.email)
    .inbox.push({ ...(await import('./fixtures/mail-world.mjs')).emails[1], id: 'g-pia' });
  await f.connect('partner');
  await f.ok('partner', 'sync');
  await f.ok('admin', 'draft.create', { id: kestrel.id });
  const fresh = await f.ok('admin', 'message.get', { id: kestrel.id }); // drafting moved the revision
  await f.ok('admin', 'triage.correct', {
    id: kestrel.id,
    changes: { tier: 2 },
    baseRevision: fresh.triage.revision,
  });
  await f.ok('admin', 'rules.save', {
    rule: { kind: 'sender', pattern: 'x@y.example', effect: { tier: 4 }, status: 'active' },
  });
  assert.equal(await f.ok('admin', 'account.disconnect'), true);
  for (const t of [
    'mail_messages',
    'mail_triage',
    'mail_drafts',
    'mail_corrections',
    'mail_rules',
    'mail_oauth_states',
    'mail_accounts',
  ])
    assert.equal(f.rows(`SELECT count(*) AS n FROM ${t} WHERE member = ?`, people.admin.email)[0].n, 0, t);
  assert.equal(
    f.rows('SELECT count(*) AS n FROM mail_messages WHERE member = ?', people.partner.email)[0].n,
    1,
  );
  assert.equal((await f.ok('admin', 'account.get')).account, null);
  assert.ok(f.rows("SELECT summary FROM org_activity WHERE summary = 'Disconnected Outlook'").length);
});

test('services read the caller’s own stored triage; draftReplyFor drafts but never sends', async () => {
  const { f, kestrel } = await ready();
  const ctxOf = async (key) => ({
    db: f.db,
    env: f.options.env,
    fetch: f.w.fetcher,
    now: Date.now(),
    user: people[key],
    member: await getMember(f.db, people[key].email),
    log: async () => {},
  });
  const admin = await ctxOf('admin');
  const partner = await ctxOf('partner');
  const graphBefore = f.w.graphCalls().length;
  assert.equal(await mailConnected(admin), true);
  assert.equal(await mailConnected(partner), false);
  assert.equal(await mailCounts(partner), null);
  const counts = await mailCounts(admin);
  assert.equal(counts.urgent, 2);
  const queue = await mailQueue(admin, 'needs_me', 5);
  assert.equal(queue[0].triage.tier, 1);
  assert.ok(queue.some((i) => i.id === kestrel.id));
  assert.deepEqual(await mailQueue(partner, 'needs_me'), []);
  assert.deepEqual(
    (await searchMail(admin, 'kestrel indemnity')).map((i) => i.id),
    [kestrel.id],
  );
  assert.deepEqual(await searchMail(partner, 'kestrel'), []);
  assert.equal(f.w.graphCalls().length, graphBefore);
  const d = await draftReplyFor(admin, kestrel.id, 'Mention the call tomorrow.');
  assert.equal(d.status, 'draft');
  assert.ok(!f.w.graphCalls().some((c) => c.url.endsWith('/send')));
  await assert.rejects(() => draftReplyFor(partner, kestrel.id), /could not be found/);
});
