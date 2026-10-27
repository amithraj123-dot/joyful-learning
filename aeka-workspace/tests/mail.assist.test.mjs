import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphSession } from '../modules/mail/server/graph.ts';
import { loadAccount } from '../modules/mail/server/store.ts';
import { PROMISE, parseCommitments } from '../modules/mail/server/commitments.ts';
import { zonedTime } from '../modules/mail/server/sync.ts';
import { vipFloor } from '../modules/mail/server/triage.ts';
import { people } from './fixtures/workflow-firm.mjs';
import { defaultAi, emails, mailFirm } from './fixtures/mail-world.mjs';

const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const IST = 330 * MIN;
const GRANTED = 'Mail.ReadWrite Mail.Send User.Read Calendars.Read openid email profile';
const person = (name, address) => ({ emailAddress: { name, address } });
const AMITH = person('Amith Rao', 'amith@aeka.example');
const RAHUL = person('Rahul Mehta', 'rahul@falcon-industries.example');
const triageBatches = (f) =>
  f.w.ai
    .map((b) => b.messages[1].content)
    .filter((u) => u.startsWith('Triage'))
    .map((u) => JSON.parse(u.slice(u.indexOf('\n') + 1)));
const aiOf = (f, prefix) => f.w.ai.filter((b) => b.messages[1].content.startsWith(prefix));
const todos = (f, source) =>
  f.rows(
    'SELECT * FROM as_todos WHERE member = ? AND source = ? ORDER BY source_ref',
    people.admin.email,
    source,
  );

test('VIPs are at least Important, never Urgent by VIP status alone, and marked in the inbox', async () => {
  const f = await mailFirm();
  await f.connect();
  await f.ok('admin', 'rules.save', {
    rule: { kind: 'domain', pattern: 'vendor.example', effect: { vip: true }, status: 'active' },
  });
  await f.ok('admin', 'rules.save', {
    rule: { kind: 'sender', pattern: 'mona@aeka.example', effect: { vip: true }, status: 'active' },
  });
  // A VIP's routine note the model rates tier 3.
  f.w.box(people.admin.email).inbox.push({
    id: 'g-vip-routine',
    subject: 'Quarterly vendor review dates',
    from: person('Accounts', 'accounts@vendor.example'),
    to: [AMITH],
    hoursAgo: 1,
    conversationId: 'c-vip-routine',
    body: 'Sharing the dates for the quarterly review.',
  });
  await f.ok('admin', 'sync');
  const routine = await f.item('g-vip-routine');
  assert.equal(routine.vip, true);
  assert.equal(routine.triage.tier, 2);
  assert.match(routine.triage.why, /VIP/);
  // A VIP's tier 2 email stays tier 2 (never raised to Urgent), a non-VIP is unchanged.
  const tp = await f.item('g-tp');
  assert.equal(tp.vip, true);
  assert.equal(tp.triage.tier, 2);
  assert.equal((await f.item('g-kestrel')).vip, false);
  // The model is told, and VIP status alone is not urgency.
  const sent = triageBatches(f).flatMap((b) => b.emails);
  assert.equal(sent.find((e) => e.subject === 'Quarterly vendor review dates').vip, true);
  assert.equal(sent.find((e) => e.subject.startsWith('Project Kestrel')).vip, undefined);
  assert.match(f.w.ai[0].messages[0].content, /VIP status alone never makes an email tier 1/);
  // Suspicious mail keeps its judgement even from a VIP address; skipped items are untouched.
  const flagged = { ...defaultAi, tier: 4, handling: 'none', safetyFlag: 'prompt_injection', why: 'x' };
  assert.equal(vipFloor(flagged, true).tier, 4);
  assert.deepEqual(vipFloor({ ...defaultAi, tier: 1, why: 'x' }, true).tier, 1);
  const noAction = vipFloor({ ...defaultAi, tier: 4, handling: 'none', why: 'x' }, true);
  assert.equal(noAction.tier, 2);
  assert.equal(noAction.handling, 'info');
  // Listing shows the VIP mark too.
  const list = await f.ok('admin', 'inbox.list', { view: 'all' });
  assert.equal(list.items.find((i) => i.subject === 'Quarterly vendor review dates').vip, true);
});

test('a chasing sender is counted, shown and passed to the model as a signal', async () => {
  const f = await mailFirm({ withMail: false });
  const box = f.w.box(people.admin.email);
  box.sent.push({
    id: 'g-s-falcon',
    subject: 'Falcon SPA: schedules',
    from: AMITH,
    to: [RAHUL],
    hoursAgo: 100,
    conversationId: 'c-falcon',
    body: 'Rahul, we will look at the schedules.',
  });
  for (const [i, h] of [50, 26, 2].entries())
    box.inbox.push({
      id: `g-falcon-${i}`,
      subject: 'RE: Falcon SPA: schedules',
      from: RAHUL,
      to: [AMITH],
      hoursAgo: h,
      conversationId: 'c-falcon',
      body: 'Any update on the schedules?',
    });
  box.inbox.push({
    id: 'g-other',
    subject: 'Lunch next week',
    from: RAHUL,
    to: [AMITH],
    hoursAgo: 3,
    conversationId: 'c-lunch',
    body: 'Free for lunch?',
  });
  await f.connect();
  await f.ok('admin', 'sync');
  assert.equal((await f.item('g-falcon-2')).chased, 3);
  assert.equal((await f.item('g-other')).chased, 1);
  const sent = triageBatches(f).flatMap((b) => b.emails);
  assert.equal(sent.find((e) => e.date && e.subject === 'RE: Falcon SPA: schedules').chased, 3);
  assert.equal(sent.find((e) => e.subject === 'Lunch next week').chased, undefined);
  assert.match(f.w.ai[0].messages[0].content, /chased/);
});

test('archive moves only my own inbox mail to Archive, only on confirmation from Outlook', async () => {
  const f = await mailFirm();
  await f.connect();
  await f.connect('partner');
  await f.ok('admin', 'sync');
  const digest = await f.item('g-digest');
  const read = await f.item('g-read');
  // Another member cannot archive my mail: it is simply not found.
  assert.equal((await f.mail('partner', 'message.archive', { ids: [digest.id] })).status, 404);
  assert.equal(f.w.moved.length, 0);
  const r = await f.ok('admin', 'message.archive', { ids: [digest.id, read.id, digest.id] });
  assert.equal(r.archived, 2);
  assert.deepEqual(f.w.moved.sort(), ['g-digest', 'g-read']);
  const moves = f.w.graphCalls().filter((c) => c.url.endsWith('/move'));
  assert.ok(
    moves.every((c) => c.method === 'POST' && JSON.stringify(c.body) === '{"destinationId":"archive"}'),
  );
  const low = await f.ok('admin', 'inbox.list', { view: 'low' });
  assert.ok(!low.items.some((i) => i.id === digest.id || i.id === read.id));
  // Already archived: nothing to do.
  assert.equal((await f.mail('admin', 'message.archive', { ids: [digest.id] })).status, 404);
  assert.equal((await f.mail('admin', 'message.archive', { ids: [] })).status, 400);
  // Outlook refuses (throttled): nothing is reported archived.
  f.w.moveStatus = 429;
  const docusign = await f.item('g-docusign');
  const refused = await f.mail('admin', 'message.archive', { ids: [docusign.id] });
  assert.equal(refused.status, 502);
  assert.equal((await f.item('g-docusign')).id, docusign.id);
  assert.equal(f.rows('SELECT removed_at FROM mail_messages WHERE id = ?', docusign.id)[0].removed_at, null);
  // The throttle pauses every later Outlook call for this member, not only the sync.
  assert.ok(
    f.rows('SELECT until FROM core_leases WHERE name = ?', `mail-busy:${people.admin.email}`)[0].until >
      Date.now(),
  );
  // Emails archived by hand count in the stats.
  assert.equal((await f.ok('admin', 'stats')).archived30d, 2);
  // The allow-list permits no other destination and no message outside the stored inbox.
  const session = new GraphSession(
    { db: f.db, env: f.options.env, fetch: f.w.fetcher, now: Date.now() },
    await loadAccount(f.db, people.admin.email),
  );
  for (const [path, body] of [
    ['/me/messages/g-docusign/move', { destinationId: 'deleteditems' }],
    ['/me/messages/g-docusign/move', { destinationId: 'archive', extra: 1 }],
    ['/me/messages/g-sent-invoice/move', { destinationId: 'archive' }],
    ['/me/messages/g-unknown/move', { destinationId: 'archive' }],
  ])
    await assert.rejects(session.request('POST', path, body), /not permitted/);
});

test('archiving noise is off by default; when on it takes only rule-triaged bulk mail, never VIPs', async () => {
  const f = await mailFirm();
  await f.connect();
  await f.ok('admin', 'sync');
  const t0 = Date.now();
  await f.tick('admin', t0 + 3 * MIN);
  assert.equal(f.w.moved.length, 0);
  await f.ok('admin', 'rules.save', {
    rule: { kind: 'domain', pattern: 'docusign.example', effect: { vip: true }, status: 'active' },
  });
  const account = await f.ok('admin', 'account.get');
  const updated = await f.ok('admin', 'account.update', {
    settings: { ...account.account.settings, archiveNoise: true },
  });
  assert.equal(updated.settings.archiveNoise, true);
  assert.equal(updated.settings.autoTodos, true);
  // The sync action never archives; only the background pass does.
  await f.ok('admin', 'sync');
  assert.equal(f.w.moved.length, 0);
  await f.tick('admin', t0 + 6 * MIN);
  // Newsletter, calendar response and read receipt: yes. DocuSign (a VIP): no. The injection email is
  // tier 4 by the AI, so it stays. Nothing linked to a mandate or above tier 4 moves.
  assert.deepEqual(f.w.moved.sort(), ['g-accepted', 'g-digest', 'g-read']);
  assert.equal((await f.item('g-inject')).triage.tier, 4);
  const stats = await f.ok('admin', 'stats');
  assert.equal(stats.archived30d, 3);
  await f.tick('admin', t0 + 9 * MIN);
  assert.equal(f.w.moved.length, 3); // nothing archived twice
});

test('a meeting invitation records its times and notes clashes, not its own tentative event', async () => {
  const f = await mailFirm({ withMail: false });
  f.w.scope = GRANTED;
  const now = Date.now();
  const day = Math.floor((now + IST) / DAY) * DAY - IST + DAY; // tomorrow, 00:00 India time
  const istString = (ms) => new Date(ms + IST).toISOString().slice(0, 19) + '.0000000';
  const event = (id, subject, startH, endH, over = {}) => ({
    id,
    subject,
    start: { dateTime: istString(day + startH * HOUR), timeZone: 'India Standard Time' },
    end: { dateTime: istString(day + endH * HOUR), timeZone: 'India Standard Time' },
    isAllDay: false,
    organizer: person('Pia Nair', 'pia@aeka.example'),
    attendees: [],
    isOrganizer: false,
    responseStatus: { response: 'accepted' },
    showAs: 'busy',
    isCancelled: false,
    ...over,
  });
  const box = f.w.box(people.admin.email);
  box.events.push(
    event('e1', 'Partners meeting', 11.5, 12.5),
    event('e2', 'Kestrel diligence call', 11, 12, {
      responseStatus: { response: 'none' },
      showAs: 'tentative',
    }),
    event('e3', 'Declined lunch', 11, 12, { responseStatus: { response: 'declined' } }),
  );
  box.inbox.push(
    {
      id: 'g-invite',
      subject: 'Kestrel diligence call',
      from: person('Ananya Rao', 'ananya.rao@northwind-holdings.example'),
      to: [AMITH],
      hoursAgo: 1,
      conversationId: 'c-invite',
      body: 'Please join the diligence call.',
      meeting: { start: day + 11 * HOUR, end: day + 12 * HOUR },
    },
    {
      id: 'g-plain',
      subject: 'Kestrel diligence call notes',
      from: person('Ananya Rao', 'ananya.rao@northwind-holdings.example'),
      to: [AMITH],
      hoursAgo: 1,
      conversationId: 'c-plain',
      body: 'Notes attached.',
    },
  );
  await f.connect();
  await f.ok('admin', 'sync');
  const row = f.rows("SELECT meeting_start, meeting_end FROM mail_messages WHERE graph_id = 'g-invite'")[0];
  assert.equal(row.meeting_start, day + 11 * HOUR);
  assert.equal(row.meeting_end, day + 12 * HOUR);
  const invite = await f.item('g-invite');
  assert.equal(invite.meetingClash, 'Partners meeting, 11:30 am');
  assert.match(invite.triage.why, /Clashes with Partners meeting, 11:30 am\./);
  const plain = await f.item('g-plain');
  assert.equal(plain.meetingClash, null);
  assert.equal(
    f.rows("SELECT meeting_start FROM mail_messages WHERE graph_id = 'g-plain'")[0].meeting_start,
    null,
  );
  // The times were read once, with a narrow select; the invitation was triaged like any other email.
  const reads = f.w.graphCalls().filter((c) => c.url.includes('select=startDateTime'));
  assert.equal(reads.length, 1);
  assert.equal(triageBatches(f).length, 1);
  await f.ok('admin', 'sync');
  assert.equal(f.w.graphCalls().filter((c) => c.url.includes('select=startDateTime')).length, 1);
  // Time zones Outlook may use.
  assert.equal(
    zonedTime({ dateTime: '2026-10-28T05:30:00.0000000', timeZone: 'UTC' }),
    Date.parse('2026-10-28T05:30:00Z'),
  );
  assert.equal(
    zonedTime({ dateTime: '2026-10-28T11:00:00.0000000', timeZone: 'India Standard Time' }),
    Date.parse('2026-10-28T11:00:00+05:30'),
  );
  assert.ok(Number.isNaN(zonedTime({ dateTime: '2026-10-28T11:00:00', timeZone: 'Pacific Standard Time' })));
});

test('urgent and important asks become linked to-dos once; the setting turns it off', async () => {
  const f = await mailFirm();
  await f.connect();
  await f.ok('admin', 'sync');
  const list = todos(f, 'mail');
  const kestrel = await f.item('g-kestrel');
  const tp = await f.item('g-tp');
  assert.deepEqual(list.map((t) => t.source_ref).sort(), [kestrel.id, tp.id].sort());
  const k = list.find((t) => t.source_ref === kestrel.id);
  assert.equal(k.title, emails[0].ai.asks[0]);
  assert.equal(k.priority, 'high');
  assert.equal(k.due_at, Date.parse('2026-10-28T18:00:00+05:30'));
  assert.equal(k.source_label, emails[0].subject);
  assert.equal(list.find((t) => t.source_ref === tp.id).priority, 'normal');
  // A retry of triage does not add it twice.
  f.db.sql.prepare("UPDATE mail_triage SET status = 'failed' WHERE message_id = ?").run(kestrel.id);
  await f.ok('admin', 'triage.retry', { id: kestrel.id });
  assert.equal(todos(f, 'mail').length, 2);

  const g = await mailFirm();
  await g.connect();
  const a = await g.ok('admin', 'account.get');
  await g.ok('admin', 'account.update', { settings: { ...a.account.settings, autoTodos: false } });
  await g.ok('admin', 'sync');
  assert.equal(todos(g, 'mail').length, 0);
});

test('commitments in sent mail become to-dos; each sent email is examined once', async () => {
  assert.ok(PROMISE.test('I will send the revised note by Friday.'));
  assert.ok(PROMISE.test('We shall revert tomorrow.'));
  assert.ok(PROMISE.test('Will share by 3 Nov.'));
  assert.ok(!PROMISE.test('Received, thank you. Our accounts team will process it.'));
  assert.equal(parseCommitments('not json', new Set(['s1'])), null);
  const parsed = parseCommitments(
    JSON.stringify({
      items: [
        { id: 's1', commitments: [{ text: 'Send the note', due: '2026-02-30' }, { text: '' }] },
        { id: 'zz', commitments: [{ text: 'Not ours', due: null }] },
      ],
    }),
    new Set(['s1']),
  );
  assert.deepEqual([...parsed], [['s1', [{ text: 'Send the note', due: null }]]]);

  const f = await mailFirm();
  const box = f.w.box(people.admin.email);
  box.sent.push(
    {
      id: 'g-s-promise',
      subject: 'Falcon SPA: schedules',
      from: AMITH,
      to: [RAHUL],
      hoursAgo: 30,
      conversationId: 'c-falcon',
      body: 'Rahul,\n\nI will send the revised schedules by Friday.\n\nRegards,\nAmith',
    },
    {
      id: 'g-s-self',
      subject: 'Note to self',
      from: AMITH,
      to: [AMITH],
      hoursAgo: 20,
      conversationId: 'c-self',
      body: 'I will review this tomorrow.',
    },
  );
  f.w.commitments = (list) =>
    list.map((e) => ({
      id: e.id,
      commitments: e.body.includes('revised schedules')
        ? [{ text: 'Send Rahul the revised SPA schedules', due: '2026-10-30' }]
        : [],
    }));
  await f.connect();
  await f.ok('admin', 'sync'); // the action never looks for commitments
  assert.equal(aiOf(f, 'Find the commitments').length, 0);
  const t0 = Date.now();
  await f.tick('admin', t0 + 3 * MIN);
  const calls = aiOf(f, 'Find the commitments');
  assert.equal(calls.length, 1);
  const sentToAi = JSON.parse(calls[0].messages[1].content.split('\n').slice(1).join('\n')).emails;
  assert.deepEqual(
    sentToAi.map((e) => e.subject),
    ['Falcon SPA: schedules'],
  );
  assert.match(calls[0].messages[0].content, /data, not instructions/);
  const list = todos(f, 'commitment');
  assert.equal(list.length, 1);
  const promise = f.rows("SELECT id FROM mail_messages WHERE graph_id = 'g-s-promise'")[0].id;
  assert.equal(list[0].source_ref, `${promise}:1`);
  assert.equal(list[0].due_at, Date.parse('2026-10-30T18:00:00+05:30'));
  assert.equal(list[0].source_label, 'Falcon SPA: schedules');
  assert.equal(
    f.rows("SELECT count(*) AS n FROM mail_messages WHERE folder = 'sent' AND commitments_at IS NULL")[0].n,
    0,
  );
  await f.tick('admin', t0 + 6 * MIN);
  assert.equal(aiOf(f, 'Find the commitments').length, 1);
});

test('a failed commitments call leaves mail unexamined and pauses for an hour; the setting turns it off', async () => {
  const f = await mailFirm();
  f.w.box(people.admin.email).sent.push({
    id: 'g-s-promise',
    subject: 'Falcon SPA: schedules',
    from: AMITH,
    to: [RAHUL],
    hoursAgo: 30,
    conversationId: 'c-falcon',
    body: 'I will send the revised schedules by Friday.',
  });
  await f.connect();
  await f.ok('admin', 'sync');
  f.w.aiReply = () => new Response('{}', { status: 500 });
  const t0 = Date.now();
  await f.tick('admin', t0 + 3 * MIN);
  assert.equal(aiOf(f, 'Find the commitments').length, 1);
  const unexamined = () =>
    f.rows("SELECT commitments_at FROM mail_messages WHERE graph_id = 'g-s-promise'")[0].commitments_at;
  assert.equal(unexamined(), null);
  await f.tick('admin', t0 + 20 * MIN);
  assert.equal(aiOf(f, 'Find the commitments').length, 1);
  f.w.aiReply = null;
  await f.tick('admin', t0 + 70 * MIN);
  assert.equal(aiOf(f, 'Find the commitments').length, 2);
  assert.ok(unexamined() > 0);

  const g = await mailFirm();
  g.w.box(people.admin.email).sent.push({
    id: 'g-s-promise',
    subject: 'Falcon SPA',
    from: AMITH,
    to: [RAHUL],
    hoursAgo: 30,
    conversationId: 'c-falcon',
    body: 'I will send it tomorrow.',
  });
  await g.connect();
  const a = await g.ok('admin', 'account.get');
  await g.ok('admin', 'account.update', { settings: { ...a.account.settings, trackCommitments: false } });
  await g.ok('admin', 'sync');
  await g.tick('admin', Date.now() + 3 * MIN);
  assert.equal(aiOf(g, 'Find the commitments').length, 0);
});
