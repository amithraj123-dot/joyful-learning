import test from 'node:test';
import assert from 'node:assert/strict';
import { people } from './fixtures/workflow-firm.mjs';
import { emails, mailFirm } from './fixtures/mail-world.mjs';

const MIN = 60000;
const person = (name, address) => ({ emailAddress: { name, address } });
const AMITH = person('Amith Rao', 'amith@aeka.example');
const extra = (id, subject, from, hoursAgo = 1, body = 'Please see the note below.') => ({
  id,
  subject,
  from,
  to: [AMITH],
  hoursAgo,
  conversationId: 'c-' + id,
  body,
});
const subjectsSentToAi = (f) =>
  f.w.ai.flatMap((b) => {
    const user = b.messages[1].content;
    return user.startsWith('Triage') ? JSON.parse(user.slice(user.indexOf('\n') + 1)).emails.map((e) => e.subject) : [];
  });

test('built-in rules keep bulk, no-reply, calendar and receipt mail away from the AI', async () => {
  const f = await mailFirm();
  await f.connect();
  await f.ok('admin', 'sync');
  const sentToAi = subjectsSentToAi(f);
  for (const id of ['g-digest', 'g-docusign', 'g-accepted', 'g-read']) {
    const item = await f.item(id);
    assert.equal(item.triage.source, 'rules', id);
    assert.equal(item.triage.tier, 4, id);
    assert.equal(item.triage.handling, 'none', id);
    assert.equal(item.triage.replyNeeded, 'no', id);
    assert.ok(['newsletter', 'notification'].includes(item.triage.category), id);
    assert.ok(!sentToAi.includes(item.subject), id);
  }
  // A statutory notice from a government no-reply address is still read by the AI.
  assert.ok(sentToAi.includes('Notice under section 143(2) for AY 2025-26'));
  // The partner had already replied in the invoice thread: no AI spent on it.
  const invoice = await f.item('g-invoice');
  assert.equal(invoice.triage.status, 'skipped');
  assert.equal(invoice.repliedByMe, true);
  assert.ok(!sentToAi.includes('Invoice INV-2291 due'));
  // One batch carried the remaining five, with truncated bodies, the tier scale and the injection defence.
  assert.equal(f.w.ai.length, 1);
  assert.equal(f.w.ai[0].response_format.type, 'json_object');
  const system = f.w.ai[0].messages[0].content;
  for (const phrase of ['Sender seniority alone never makes an email urgent', 'prompt_injection', 'FEMA', 'client_matter', 'delegate'])
    assert.ok(system.includes(phrase), phrase);
  // The injection attempt is flagged and handled on its real content.
  const inject = await f.item('g-inject');
  assert.equal(inject.triage.safetyFlag, 'prompt_injection');
  assert.equal(inject.triage.tier, 4);
  // Suggestions are validated: the delegate is a real member and the mandate is a real id.
  const fcgpr = await f.item('g-fcgpr');
  assert.equal(fcgpr.triage.delegate, people.associate.email);
  assert.equal(fcgpr.triage.matterId, f.open.id);
  assert.equal(fcgpr.triage.matterConfidence, 'suggested');
  assert.equal(fcgpr.triage.deadline, '2026-11-19');
  assert.equal(fcgpr.triage.draftDecision, 'undecided'); // asked, never drafted
  assert.equal(f.rows('SELECT count(*) AS n FROM mail_drafts')[0].n, 0);
});

test('an invalid AI item is retried alone with backoff, then fails after 3 attempts', async () => {
  const f = await mailFirm();
  await f.connect();
  const t0 = Date.now();
  f.w.aiReply = (body) => {
    const user = body.messages[1].content;
    const data = JSON.parse(user.slice(user.indexOf('\n') + 1));
    return JSON.stringify({
      items: data.emails.map((e) => {
        const known = emails.find((x) => x.subject === e.subject);
        // An enum the contract does not allow, for the Kestrel email only.
        return e.subject.startsWith('Project Kestrel')
          ? { id: e.id, ...known.ai, handling: 'escalate' }
          : { id: e.id, ...known.ai };
      }),
    });
  };
  await f.ok('admin', 'sync');
  const state = () => f.rows("SELECT t.* FROM mail_triage t JOIN mail_messages m ON m.id = t.message_id WHERE m.graph_id = 'g-kestrel'")[0];
  assert.equal(state().status, 'pending');
  assert.equal(state().attempts, 1);
  assert.equal(f.w.ai.length, 1);

  await f.tick('admin', t0 + 2 * MIN); // not yet due (5 minutes)
  assert.equal(f.w.ai.length, 1);
  await f.tick('admin', t0 + 6 * MIN);
  assert.equal(f.w.ai.length, 2);
  assert.equal(subjectsSentToAi(f).slice(-1)[0], emails[0].subject); // alone
  assert.equal(JSON.parse(f.w.ai[1].messages[1].content.split('\n').slice(1).join('\n')).emails.length, 1);
  assert.equal(state().attempts, 2);
  await f.tick('admin', t0 + 20 * MIN); // 30 minutes after the second attempt
  assert.equal(f.w.ai.length, 2);
  await f.tick('admin', t0 + 40 * MIN);
  assert.equal(f.w.ai.length, 3);
  assert.equal(state().status, 'failed');
  assert.match(state().error, /3 attempts/);
  await f.tick('admin', t0 + 600 * MIN); // failed items are left alone
  assert.equal(f.w.ai.length, 3);

  const list = await f.ok('admin', 'inbox.list', { view: 'failed' });
  assert.equal(list.counts.failed, 1);
  assert.equal(list.items[0].triage.error.length > 0, true);
  // The member asks again, and the AI now answers properly.
  f.w.aiReply = null;
  const retried = await f.ok('admin', 'triage.retry', { id: list.items[0].id });
  assert.equal(retried.status, 'done');
  assert.equal(retried.tier, 1);
  assert.equal((await f.mail('admin', 'triage.retry', { id: list.items[0].id })).status, 409);
});

test('a whole-batch AI failure pauses the queue and counts at most one attempt an hour', async () => {
  const f = await mailFirm();
  await f.connect();
  const t0 = Date.now();
  f.w.aiReply = () => new Response('{"error":"upstream"}', { status: 500 });
  const r = await f.ok('admin', 'sync');
  assert.equal(r.pending, 5);
  assert.equal(f.w.ai.length, 1);
  const attempts = () => f.rows("SELECT max(attempts) AS n FROM mail_triage WHERE status = 'pending'")[0].n;
  assert.equal(attempts(), 0);
  for (const m of [1, 3, 5, 10]) await f.tick('admin', t0 + m * MIN);
  assert.equal(f.w.ai.length, 1); // no storm: paused for 15 minutes
  await f.tick('admin', t0 + 16 * MIN);
  assert.equal(f.w.ai.length, 2);
  await f.tick('admin', t0 + 65 * MIN);
  assert.equal(attempts(), 1);
  await f.tick('admin', t0 + 81 * MIN);
  await f.tick('admin', t0 + 97 * MIN);
  assert.equal(attempts(), 1); // at most once per hour
  assert.equal(f.w.ai.length, 5);
  const account = (await f.ok('admin', 'account.get')).account;
  assert.match(account.lastError, /AI triage is paused/);
  assert.equal((await f.ok('admin', 'inbox.list', { view: 'all' })).counts.failed, 0);
  // Each failed call was metered.
  assert.equal(f.rows("SELECT count(*) AS n FROM ai_usage WHERE ok = 0 AND module = 'mail'")[0].n, 5);
});

test('at most 25 emails go to the AI per sync, in batches of up to 8', async () => {
  const f = await mailFirm({ withMail: false });
  const box = f.w.box(people.admin.email);
  for (let i = 0; i < 30; i++)
    box.inbox.push(extra(`g-x${i}`, `Query ${i} on the share swap`, person(`Client ${i}`, `c${i}@client${i}.example`), 1 + i / 10));
  await f.connect();
  const r = await f.ok('admin', 'sync');
  const sizes = f.w.ai.map((b) => JSON.parse(b.messages[1].content.split('\n').slice(1).join('\n')).emails.length);
  assert.deepEqual(sizes, [8, 8, 8, 1]);
  assert.equal(r.pending, 5);
  for (const b of f.w.ai) for (const e of JSON.parse(b.messages[1].content.split('\n').slice(1).join('\n')).emails) assert.ok(e.body.length <= 2500);
});

test('corrections teach: examples in later prompts, a proposed rule after 3, applied without AI once accepted', async () => {
  const f = await mailFirm({ withMail: false });
  const box = f.w.box(people.admin.email);
  const chamber = person('Chamber Events', 'events@chamber.example');
  box.inbox.push(
    extra('g-c1', 'Breakfast meeting on the Union Budget', chamber, 3),
    extra('g-c2', 'Seminar on GAAR and treaty shopping', chamber, 2),
    extra('g-c3', 'Annual dinner invitation', chamber, 1),
  );
  await f.connect();
  await f.ok('admin', 'sync');
  assert.equal(f.w.ai.length, 1);
  for (const [i, id] of ['g-c1', 'g-c2', 'g-c3'].entries()) {
    const item = await f.item(id);
    assert.equal(item.triage.tier, 3);
    const t = await f.ok('admin', 'triage.correct', { id: item.id, changes: { tier: 4, handling: 'none' }, baseRevision: item.triage.revision });
    assert.equal(t.tier, 4);
    assert.equal(t.source, 'manual');
    assert.equal(t.corrected, true);
    const rules = await f.ok('admin', 'rules.list');
    assert.equal(rules.length, i < 2 ? 0 : 1);
  }
  // A stale revision is refused.
  const c1 = await f.item('g-c1');
  assert.equal((await f.mail('admin', 'triage.correct', { id: c1.id, changes: { tier: 2 }, baseRevision: 0 })).status, 409);
  const [rule] = await f.ok('admin', 'rules.list');
  assert.equal(rule.status, 'proposed');
  assert.equal(rule.kind, 'sender');
  assert.equal(rule.pattern, 'events@chamber.example');
  assert.deepEqual(rule.effect, { tier: 4, handling: 'none' });
  assert.equal(rule.evidence, 3);
  assert.equal(f.rows('SELECT count(*) AS n FROM mail_corrections')[0].n, 6);

  // While only proposed, the rule does not apply: new chamber mail still goes to the AI, with examples.
  box.changes.push(extra('g-c4', 'Members directory update', chamber, 0.5));
  await f.ok('admin', 'sync');
  assert.equal(f.w.ai.length, 2);
  assert.match(f.w.ai[1].messages[1].content, /"corrected":"tier = 4"/);
  assert.match(f.w.ai[1].messages[1].content, /chamber\.example/);

  await f.ok('admin', 'rules.save', { rule: { ...rule, status: 'active' } });
  box.changes.push(extra('g-c5', 'Golf day sign-up', chamber, 0.2));
  await f.ok('admin', 'sync');
  assert.equal(f.w.ai.length, 2); // the accepted rule decided without AI
  const c5 = await f.item('g-c5');
  assert.equal(c5.triage.source, 'rule');
  assert.equal(c5.triage.tier, 4);
  const stats = await f.ok('admin', 'stats');
  assert.equal(stats.corrected30d, 3);
  assert.deepEqual(stats.correctionsByField, { tier: 3, handling: 3 });
  assert.equal(stats.aiCallsToday, 2);
});

test('a neverAi rule keeps a sender out of every AI request, including drafting', async () => {
  const f = await mailFirm();
  await f.connect();
  await f.ok('admin', 'rules.save', {
    rule: { kind: 'domain', pattern: '@Secret-Client.example', effect: { neverAi: true }, status: 'active' },
  });
  f.w.box(people.admin.email).inbox.push(
    extra('g-secret', 'Board note on the confidential merger', person('Neha', 'neha@secret-client.example'), 1, 'Merger ratio 3:2, please advise urgently.'),
  );
  await f.ok('admin', 'sync');
  assert.ok(f.w.ai.length >= 1);
  assert.ok(!f.w.aiText().includes('secret-client'));
  assert.ok(!f.w.aiText().includes('Merger ratio'));
  const item = await f.item('g-secret');
  assert.equal(item.triage.source, 'rule');
  assert.equal(item.triage.why, 'Kept from AI by your rule.');
  assert.equal(item.triage.handling, 'uncertain');
  const draft = await f.mail('admin', 'draft.create', { id: item.id });
  assert.equal(draft.status, 409);
  assert.ok(!f.w.aiText().includes('Merger ratio'));
});

test('with AI triage off, built-in heuristics never claim a reply is needed', async () => {
  const f = await mailFirm();
  await f.connect();
  await f.ok('admin', 'account.update', { settings: { aiTriage: false, alertUrgent: true } });
  await f.ok('admin', 'sync');
  assert.equal(f.w.ai.length, 0);
  const all = (await f.ok('admin', 'inbox.list', { view: 'all' })).items;
  assert.ok(all.every((i) => i.triage.handling !== 'reply' && i.triage.replyNeeded !== 'yes'));
  const kestrel = await f.item('g-kestrel');
  assert.equal(kestrel.triage.handling, 'uncertain');
  assert.equal(kestrel.triage.replyNeeded, 'maybe');
  assert.equal((await f.item('g-digest')).triage.replyNeeded, 'no');
  // The same without an AI service configured.
  const g = await mailFirm();
  delete g.options.env.LITELLM_API_KEY;
  await g.connect();
  await g.ok('admin', 'sync');
  assert.equal(g.w.ai.length, 0);
  assert.match((await g.item('g-tp')).triage.why, /not available/);
});

test('an urgent item notifies once', async () => {
  const f = await mailFirm();
  await f.connect();
  await f.ok('admin', 'sync');
  const notices = () => f.rows("SELECT * FROM org_notifications WHERE kind = 'mail.urgent'");
  assert.equal(notices().length, 2); // the closing and the tax notice
  assert.equal(notices()[0].recipient, people.admin.email);
  assert.equal(notices()[0].link, 'mail/inbox');
  // Even if the item were triaged again, the alert is not repeated.
  f.db.sql.exec("UPDATE mail_triage SET status = 'pending', next_attempt_at = 0");
  await f.tick('admin', Date.now() + 5 * MIN);
  assert.equal(notices().length, 2);
  // Alerts can be switched off.
  const g = await mailFirm();
  await g.connect();
  await g.ok('admin', 'account.update', { settings: { aiTriage: true, alertUrgent: false } });
  await g.ok('admin', 'sync');
  assert.equal(g.rows("SELECT * FROM org_notifications WHERE kind = 'mail.urgent'").length, 0);
});

test('a revoked sign-in pauses syncing and notifies once; throttling waits for Retry-After', async () => {
  const f = await mailFirm();
  f.w.expiresIn = 60; // always within the refresh margin
  await f.connect();
  const first = await f.ok('admin', 'sync');
  assert.equal(first.fetched, 11);
  const refreshes = f.w.calls.filter((c) => c.url.includes('/token') && String(c.body).includes('refresh_token'));
  assert.ok(refreshes.length >= 1);
  // The rotated refresh token was stored (the newest one is used next).
  const usedLast = new URLSearchParams(refreshes.at(-1).body).get('refresh_token');
  assert.notEqual(usedLast, `rt-${people.admin.email}-1`);

  f.w.refresh = 'invalid_grant';
  assert.equal((await f.mail('admin', 'sync')).status, 409);
  const account = (await f.ok('admin', 'account.get')).account;
  assert.equal(account.status, 'reauth');
  const before = f.w.graphCalls().length;
  await f.tick('admin', Date.now() + 10 * MIN);
  await f.tick('admin', Date.now() + 20 * MIN);
  assert.equal(f.w.graphCalls().length, before);
  assert.equal(f.rows("SELECT count(*) AS n FROM org_notifications WHERE kind = 'mail.reauth'")[0].n, 1);

  const g = await mailFirm();
  await g.connect();
  g.w.deltaStatus = 429;
  const t0 = Date.now();
  await g.ok('admin', 'sync');
  assert.match((await g.ok('admin', 'account.get')).account.lastError, /slow down/);
  const calls = g.w.graphCalls().length;
  await g.tick('admin', t0 + 1 * MIN);
  assert.equal(g.w.graphCalls().length, calls); // Retry-After of 120 seconds
  g.w.deltaStatus = 200;
  await g.tick('admin', t0 + 3 * MIN);
  assert.ok(g.w.graphCalls().length > calls);
  assert.equal((await g.ok('admin', 'account.get')).account.lastError, '');
});
