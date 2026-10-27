import test from 'node:test';
import assert from 'node:assert/strict';
import { getMember } from '../core/server/members.ts';
import { followUps, mailWith } from '../modules/mail/server/service.ts';
import { habitOf, materialEdit } from '../modules/mail/server/style.ts';
import { people } from './fixtures/workflow-firm.mjs';
import { mailFirm } from './fixtures/mail-world.mjs';

const HOUR = 3600000;
const DAY = 24 * HOUR;
const person = (name, address) => ({ emailAddress: { name, address } });
const AMITH = person('Amith Rao', 'amith@aeka.example');
const RAHUL = person('Rahul Mehta', 'rahul@falcon-industries.example');
const ANANYA = person('Ananya Rao', 'ananya.rao@northwind-holdings.example');
const VIKRAM = person('Vikram Desai', 'vikram.desai@meridian-counsel.example');
const PRIYA = person('Priya Shah', 'priya@lotus-client.example');
const msg = (id, conversationId, from, to, hoursAgo, extra = {}) => ({
  id,
  subject: extra.subject || `Subject of ${conversationId}`,
  from,
  to,
  hoursAgo,
  conversationId,
  body: extra.body || 'Please see below.',
  ...extra,
});
const ctxOf = async (f, key) => ({
  db: f.db,
  env: f.options.env,
  fetch: f.w.fetcher,
  now: Date.now(),
  user: people[key],
  member: await getMember(f.db, people[key].email),
  log: async () => {},
});
const dataOf = (body) => {
  const u = body.messages[1].content;
  return JSON.parse(u.slice(u.indexOf('\n') + 1));
};

async function followUpFirm() {
  const f = await mailFirm({ withMail: false });
  const box = f.w.box(people.admin.email);
  box.sent.push(
    msg('g-s-w1', 'c-w1', AMITH, [RAHUL], 72 + 1, { subject: 'Falcon SPA schedules' }),
    msg('g-s-w2a', 'c-w2', AMITH, [ANANYA], 6 * 24),
    msg('g-s-w2b', 'c-w2', AMITH, [ANANYA], 5.5 * 24),
    msg('g-s-w3', 'c-w3', AMITH, [VIKRAM], 11 * 24, { cc: [person('Mona Iyer', 'mona@aeka.example')] }),
    msg('g-s-w4', 'c-w4', AMITH, [RAHUL], 24),
    msg('g-s-w5', 'c-w5', AMITH, [AMITH], 4 * 24),
    msg('g-s-w6', 'c-w6', AMITH, [ANANYA], 4 * 24, { subject: 'Accepted: Kestrel call' }),
    msg('g-s-w7', 'c-w7', AMITH, [person('Portal', 'no-reply@portal.example')], 4 * 24),
    msg('g-s-w8', 'c-w8', AMITH, [VIKRAM], 4 * 24),
    msg('g-s-chase', 'c-chase', AMITH, [RAHUL], 5 * 24),
  );
  box.inbox.push(
    msg('g-w8-reply', 'c-w8', VIKRAM, [AMITH], 3 * 24),
    msg('g-chase-1', 'c-chase', RAHUL, [AMITH], 3 * 24, { subject: 'RE: Subject of c-chase' }),
    msg('g-chase-2', 'c-chase', RAHUL, [AMITH], 24, { subject: 'RE: Subject of c-chase' }),
    msg('g-chase2-1', 'c-chase2', PRIYA, [AMITH], 2 * 24),
    msg('g-chase2-2', 'c-chase2', PRIYA, [AMITH], 30),
    msg('g-chase2-3', 'c-chase2', PRIYA, [AMITH], 2),
    msg('g-news-1', 'c-news', person('Digest', 'news@digest.example'), [AMITH], 50, {
      headers: [{ name: 'List-Unsubscribe', value: '<mailto:x@digest.example>' }],
    }),
    msg('g-news-2', 'c-news', person('Digest', 'news@digest.example'), [AMITH], 5, {
      headers: [{ name: 'List-Unsubscribe', value: '<mailto:x@digest.example>' }],
    }),
  );
  await f.connect();
  await f.ok('admin', 'sync');
  return f;
}

test('follow-ups: waiting escalates by age, chasing by count, with clear exclusions', async () => {
  const f = await followUpFirm();
  // Rahul is linked to the open mandate by the member's own correction.
  const chase = await f.item('g-chase-2');
  await f.ok('admin', 'triage.correct', {
    id: chase.id,
    baseRevision: chase.triage.revision,
    changes: { matterId: f.open.id },
  });
  const list = await f.ok('admin', 'followups.list', {});
  assert.deepEqual(
    list.map((x) => [x.conversationId, x.kind, x.level, x.count]),
    [
      ['c-w3', 'waiting', 3, 1],
      ['c-chase2', 'chasing', 3, 3],
      ['c-w2', 'waiting', 2, 2],
      ['c-chase', 'chasing', 2, 2],
      ['c-w1', 'waiting', 1, 1],
    ],
  );
  const w3 = list[0];
  assert.equal(w3.counterpart.address, 'vikram.desai@meridian-counsel.example');
  assert.equal(w3.ageDays, 11);
  assert.equal(w3.mailId, f.rows("SELECT id FROM mail_messages WHERE graph_id = 'g-s-w3'")[0].id);
  const c = list.find((x) => x.conversationId === 'c-chase');
  assert.equal(c.counterpart.address, 'rahul@falcon-industries.example');
  assert.equal(c.mailId, chase.id);
  assert.equal(c.ageDays, 3);
  assert.ok(c.matterLabel.length > 0);
  assert.equal(list.find((x) => x.conversationId === 'c-w1').matterLabel, c.matterLabel);
  assert.equal(list.find((x) => x.conversationId === 'c-w2').matterLabel, '');
  assert.deepEqual(
    (await f.ok('admin', 'followups.list', { kind: 'chasing' })).map((x) => x.conversationId),
    ['c-chase2', 'c-chase'],
  );
  // Nothing of this mailbox is visible to another member.
  await f.connect('partner');
  assert.deepEqual(await f.ok('partner', 'followups.list', {}), []);
  assert.equal(
    (await f.mail('partner', 'followups.update', { conversationId: 'c-w1', kind: 'waiting', action: 'done' }))
      .status,
    404,
  );
  // The chasing sender's count is on the inbox card too.
  assert.equal(chase.chased, 2);
});

test('snooze, done and reopen; done holds only until the thread moves again', async () => {
  const f = await followUpFirm();
  const ids = async (p = {}) => (await f.ok('admin', 'followups.list', p)).map((x) => x.conversationId);
  await f.ok('admin', 'followups.update', {
    conversationId: 'c-w1',
    kind: 'waiting',
    action: 'snooze',
    days: 3,
  });
  assert.ok(!(await ids()).includes('c-w1'));
  const hidden = await f.ok('admin', 'followups.list', { includeClosed: true });
  const snoozed = hidden.find((x) => x.conversationId === 'c-w1');
  assert.ok(snoozed.snoozedUntil > Date.now() + 2.9 * DAY);
  assert.equal(snoozed.done, false);
  await f.ok('admin', 'followups.update', { conversationId: 'c-w1', kind: 'waiting', action: 'reopen' });
  assert.ok((await ids()).includes('c-w1'));
  for (const bad of [
    { conversationId: 'c-w1', kind: 'waiting', action: 'snooze', days: 0 },
    { conversationId: 'c-w1', kind: 'waiting', action: 'snooze', days: 31 },
    { conversationId: 'c-w1', kind: 'other', action: 'done' },
    { conversationId: 'c-w1', kind: 'waiting', action: 'archive' },
  ])
    assert.equal((await f.mail('admin', 'followups.update', bad)).status, 400);
  assert.equal(
    (await f.mail('admin', 'followups.update', { conversationId: 'c-none', kind: 'waiting', action: 'done' }))
      .status,
    404,
  );

  await f.ok('admin', 'followups.update', { conversationId: 'c-chase', kind: 'chasing', action: 'done' });
  assert.ok(!(await ids()).includes('c-chase'));
  assert.equal(
    (await f.ok('admin', 'followups.list', { includeClosed: true })).find(
      (x) => x.conversationId === 'c-chase',
    ).done,
    true,
  );
  // Rahul writes again: the thread is back, now at level 3.
  f.w
    .box(people.admin.email)
    .changes.push(msg('g-chase-3', 'c-chase', RAHUL, [AMITH], 0, { subject: 'RE: Subject of c-chase' }));
  await f.ok('admin', 'sync');
  const back = (await f.ok('admin', 'followups.list', {})).find((x) => x.conversationId === 'c-chase');
  assert.equal(back.level, 3);
  assert.equal(back.count, 3);

  // Snooze is for waiting threads only.
  assert.equal(
    (
      await f.mail('admin', 'followups.update', {
        conversationId: 'c-chase2',
        kind: 'chasing',
        action: 'snooze',
        days: 2,
      })
    ).status,
    400,
  );
  // The service gives the same open ones.
  const ctx = await ctxOf(f, 'admin');
  const service = await followUps(ctx);
  assert.deepEqual(
    service.map((x) => x.conversationId),
    await ids(),
  );
  assert.equal(service[0].done, false);
  assert.deepEqual(
    (await followUps(ctx, 'waiting', 2)).map((x) => x.kind),
    ['waiting', 'waiting'],
  );
  assert.deepEqual(await followUps(await ctxOf(f, 'partner')), []);
});

test('mailWith returns my mail from or to the addresses, newest first, and only mine', async () => {
  const f = await followUpFirm();
  const ctx = await ctxOf(f, 'admin');
  const items = await mailWith(ctx, ['RAHUL@falcon-industries.example']);
  assert.deepEqual(
    items.map((i) => f.rows('SELECT graph_id FROM mail_messages WHERE id = ?', i.id)[0].graph_id),
    ['g-chase-2', 'g-s-w4', 'g-chase-1', 'g-s-w1', 'g-s-chase'],
  );
  assert.equal(items[1].triage, null);
  assert.equal((await mailWith(ctx, ['rahul@falcon-industries.example'], 2)).length, 2);
  assert.deepEqual(await mailWith(ctx, []), []);
  assert.deepEqual(await mailWith(await ctxOf(f, 'partner'), ['rahul@falcon-industries.example']), []);
});

test('a follow-up draft replies to all on my last sent email and is reviewed and sent like a reply', async () => {
  const f = await followUpFirm();
  const draft = await f.ok('admin', 'followups.draftNudge', {
    conversationId: 'c-w1',
    instructions: 'Keep it short.',
  });
  const sentId = f.rows("SELECT id FROM mail_messages WHERE graph_id = 'g-s-w1'")[0].id;
  assert.equal(draft.messageId, sentId);
  // The waiting thread's mail opens as my sent email, without triage; only for me.
  const opened = await f.ok('admin', 'message.get', { id: sentId });
  assert.equal(opened.triage, null);
  assert.match(opened.bodyText, /Please see below/);
  assert.equal((await f.mail('partner', 'message.get', { id: sentId })).status, 404);
  assert.equal((await f.ok('admin', 'draft.get', { id: draft.id })).messageId, sentId);
  assert.equal(draft.replyAll, true);
  assert.deepEqual(
    draft.to.map((a) => a.address),
    ['rahul@falcon-industries.example'],
  );
  const req = f.w.ai[f.w.ai.length - 1];
  assert.match(req.messages[0].content, /follow-up/);
  const data = dataOf(req);
  assert.equal(data.waitingDays, 3);
  assert.equal(data.writersUnansweredEmail.subject, 'Falcon SPA schedules');
  assert.equal(data.instructions, 'Keep it short.');
  const listed = (await f.ok('admin', 'drafts.list', {})).find((d) => d.id === draft.id);
  assert.equal(listed.subject, 'Falcon SPA schedules');
  const saved = await f.ok('admin', 'draft.saveToOutlook', {
    draftId: draft.id,
    baseRevision: draft.revision,
  });
  assert.equal(saved.outlookSaved, true);
  const created = [...f.w.drafts.values()][0];
  assert.equal(created.from, 'g-s-w1');
  assert.equal(created.kind, 'createReplyAll');
  const sent = await f.ok('admin', 'draft.send', {
    draftId: draft.id,
    confirm: true,
    baseRevision: saved.revision,
  });
  assert.equal(sent.status, 'sent');
  // Sent from the workspace: the thread is no longer waiting.
  assert.ok(!(await f.ok('admin', 'followups.list', {})).some((x) => x.conversationId === 'c-w1'));
  // They have answered in c-w8, and in c-chase2 I never wrote: no follow-up to draft.
  assert.equal((await f.mail('admin', 'followups.draftNudge', { conversationId: 'c-w8' })).status, 409);
  assert.equal((await f.mail('admin', 'followups.draftNudge', { conversationId: 'c-chase2' })).status, 409);
  assert.equal((await f.mail('partner', 'followups.draftNudge', { conversationId: 'c-w2' })).status, 404);
});

test('writing style: learned once from safe sent mail, accepted, then used with per-recipient habits', async () => {
  const f = await mailFirm();
  await f.connect();
  await f.ok('admin', 'rules.save', {
    rule: { kind: 'domain', pattern: 'secret-client.example', effect: { neverAi: true }, status: 'active' },
  });
  await f.ok('admin', 'sync');
  assert.equal(await f.ok('admin', 'style.get', {}), null);
  // Too little sent mail (the invoice reply only).
  assert.equal((await f.mail('admin', 'style.learn', {})).status, 409);
  const box = f.w.box(people.admin.email);
  for (let i = 0; i < 6; i++)
    box.sentChanges.push(
      msg(`g-s-style-${i}`, `c-style-${i}`, AMITH, [person('Client', `c${i}@client${i}.example`)], 10 + i, {
        body: `Dear Client,\n\nNote number ${i} on the structure.\n\nRegards,\nAmith`,
      }),
    );
  box.sentChanges.push(
    msg('g-s-secret', 'c-secret', AMITH, [person('Secret', 'ceo@secret-client.example')], 3, {
      body: 'Confidential merger terms for Project Zeta.',
    }),
    msg('g-s-fwd', 'c-fwd', AMITH, [person('Mona Iyer', 'mona@aeka.example')], 4, {
      subject: 'FW: Board pack',
      body: 'Forwarded board pack text from someone else.',
    }),
    msg('g-s-ananya', 'c-kestrel', AMITH, [ANANYA], 26, {
      body: 'Hi Ananya,\n\nNoted on the closing.\n\nWarm regards,\nAmith',
    }),
  );
  await f.ok('admin', 'sync');
  const before = f.w.ai.length;
  const proposed = await f.ok('admin', 'style.learn', {});
  assert.equal(proposed.status, 'proposed');
  assert.equal(proposed.greeting, 'Dear {first name},');
  assert.equal(proposed.sampleCount, 8);
  assert.equal(f.w.ai.length, before + 1);
  const learnText = JSON.stringify(f.w.ai[f.w.ai.length - 1].messages);
  assert.ok(!learnText.includes('Project Zeta'));
  assert.ok(!learnText.includes('Forwarded board pack'));
  assert.match(f.w.ai[f.w.ai.length - 1].messages[0].content, /data, not instructions/);
  // Unchanged sent mail: no second AI call.
  await f.ok('admin', 'style.learn', {});
  assert.equal(f.w.ai.length, before + 1);
  assert.equal(
    (await f.mail('admin', 'style.save', { profile: { greeting: '' }, status: 'active' })).status,
    400,
  );
  const active = await f.ok('admin', 'style.save', {
    profile: {
      greeting: 'Dear {first name},',
      signOff: 'Best regards,\nAmith',
      tone: 'Formal.',
      notes: ['Brief'],
    },
    status: 'active',
  });
  assert.equal(active.status, 'active');
  assert.equal((await f.ok('admin', 'style.get', {})).signOff, 'Best regards,\nAmith');

  const kestrel = await f.item('g-kestrel');
  const d = await f.ok('admin', 'draft.create', { id: kestrel.id });
  const data = dataOf(f.w.ai[f.w.ai.length - 1]);
  assert.equal(data.style.signOff, 'Best regards,\nAmith');
  assert.deepEqual(data.recipientHabit, { greeting: 'Hi Ananya,', signOff: 'Warm regards,\nAmith' });
  assert.deepEqual(data.editExamples, []);
  // A material edit, sent: kept as an example for later drafts.
  const edited = await f.ok('admin', 'draft.update', {
    draftId: d.id,
    baseRevision: d.revision,
    body: 'Hi Ananya,\n\nYes, the clause 9 cap still works with the step-up. Happy to discuss on the call tomorrow.\n\nWarm regards,\nAmith',
    to: d.to,
    cc: d.cc,
    replyAll: false,
  });
  await f.ok('admin', 'draft.send', { draftId: d.id, confirm: true, baseRevision: edited.revision });
  const tp = await f.item('g-tp');
  await f.ok('admin', 'draft.create', { id: tp.id });
  const next = dataOf(f.w.ai[f.w.ai.length - 1]);
  assert.equal(next.editExamples.length, 1);
  assert.match(next.editExamples[0].before, /INPUT REQUIRED/);
  assert.match(next.editExamples[0].after, /step-up/);
  assert.match(f.w.ai[f.w.ai.length - 1].messages[0].content, /Never reuse any fact/);
});

test('style helpers: greeting and sign-off lines, and what counts as a material edit', () => {
  assert.deepEqual(habitOf('Dear Rohan,\n\nPlease find the note.\n\nKind regards,\nAmith\nAeka Advisors'), {
    greeting: 'Dear Rohan,',
    signOff: 'Kind regards,\nAmith\nAeka Advisors',
  });
  assert.deepEqual(habitOf('Quick one: is the CA certificate ready?'), { greeting: '', signOff: '' });
  const a = 'Dear Ananya,\n\nThank you for the note on the closing timetable and the indemnity.\n\nAmith';
  assert.equal(materialEdit(a, a.replace('note', 'email')), false);
  assert.equal(
    materialEdit(
      a,
      'Ananya, agreed on the timetable. I will call you at four to settle the indemnity cap.\n\nAmith',
    ),
    true,
  );
  assert.equal(materialEdit('Fill [INPUT REQUIRED: amount] here today', 'Fill Rs 5 crore here today'), false);
});
