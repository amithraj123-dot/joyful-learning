// Chats: messages read from the phone's notifications by the Aeka Android app. Pairing and the device
// API, storing each message once, reply state, triage (rules, chats kept from AI, AI with validation
// and fallbacks), nudges with quiet hours, drafts sent only from the phone, and privacy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getMember } from '../core/server/members.ts';
import { memberContext } from '../modules/assistant/server/context.ts';
import { buildBrief } from '../modules/assistant/server/brief.ts';
import { runTool } from '../modules/assistant/server/tools.ts';
import { chatsServer, chatsPass } from '../modules/chats/server/index.ts';
import { deviceRequest, replyState } from '../modules/chats/server/device.ts';
import { quietNow, runNudges, scheduleFor } from '../modules/chats/server/nudges.ts';
import { builtIn, runChatTriage } from '../modules/chats/server/triage.ts';
import { DEFAULT_SETTINGS } from '../modules/chats/shared/types.ts';
import { firm, people } from './fixtures/workflow-firm.mjs';

const MIN = 60000;
const HOUR = 60 * MIN;
const ist = (s) => Date.parse(s + '+05:30');
// Tuesday 27 Oct 2026, 11:00 am India time.
const T0 = ist('2026-10-27T11:00:00');
const AI_ENV = { LITELLM_BASE_URL: 'https://ai.aeka.example', LITELLM_API_KEY: 'test-key' };

async function world() {
  const ai = { calls: [], reply: null };
  const fetcher = async (url, init) => {
    if (String(url).startsWith('https://ai.aeka.example')) {
      const body = JSON.parse(init.body);
      ai.calls.push(body);
      const content = ai.reply ? ai.reply(body) : JSON.stringify({ items: [] });
      return Response.json({
        choices: [{ message: { role: 'assistant', content } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });
    }
    throw new Error('No network in tests');
  };
  const f = await firm({ env: AI_ENV, fetcher });
  const sys = (now = T0) => ({ db: f.db, env: f.options.env, fetch: (...a) => f.options.fetcher(...a), now });
  const member = async (key = 'admin') => getMember(f.db, people[key].email);
  const ctx = async (now = T0, key = 'admin') => memberContext(sys(now), await member(key));
  const action = async (name, payload, now = T0, key = 'admin') =>
    chatsServer.actions[name].handler(await ctx(now, key), payload);
  const device = async (body, { token, now = T0, after } = {}) => {
    const r = await deviceRequest(
      new Request('https://aeka-workspace.example/api/device', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      }),
      sys(now),
      after,
    );
    const j = await r.json();
    return { status: r.status, value: j.value, error: j.error };
  };
  const pair = async (key = 'admin', now = T0) => {
    const { code } = await action('phone.pairingCode', {}, now, key);
    const r = await device(
      { op: 'pair', code, name: 'Test phone', model: 'Pixel 8', appVersion: '0.9.0', android: 34 },
      { now },
    );
    assert.equal(r.status, 200, r.error);
    return r.value.token;
  };
  const rows = (q, ...p) => f.db.sql.prepare(q).all(...p);
  return { f, ai, sys, member, ctx, action, device, pair, rows };
}

let n = 0;
const msg = ({ id, ...o } = {}) => ({
  type: 'message',
  id: Buffer.from(id ?? `m${++n}`)
    .toString('hex')
    .padEnd(32, '0'),
  app: 'whatsapp',
  chat: 'whatsapp:919812345678@s.whatsapp.net',
  title: 'Rahul Mehta',
  group: false,
  sender: 'Rahul Mehta',
  fromMe: false,
  text: 'Can you send the revised valuation note today?',
  at: T0 - 5 * MIN,
  address: '919812345678',
  ...o,
});
const sync = (events, extra = {}) => ({
  op: 'sync',
  appVersion: '0.9.0',
  android: 34,
  access: { notifications: true, postNotifications: true, batteryUnrestricted: false },
  events,
  live: [],
  ...extra,
});

test('the server implements exactly the actions of the shared contract', () => {
  const contract = readFileSync(new URL('../modules/chats/shared/contract.ts', import.meta.url), 'utf8');
  const start = contract.indexOf('export interface ChatsActions');
  const block = contract.slice(start, contract.indexOf('\n}\n', start));
  const names = [...block.matchAll(/^ {2}'?([\w.]+)'?: \{/gm)].map((m) => m[1]).sort();
  assert.ok(names.length >= 15);
  assert.deepEqual(Object.keys(chatsServer.actions).sort(), names);
  assert.equal(typeof chatsServer.tick, 'function');
});

test('a phone pairs once with a 10-minute code; a revoked or unknown token is refused', async () => {
  const w = await world();
  const { code, expiresAt } = await w.action('phone.pairingCode', {});
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(expiresAt, T0 + 10 * MIN);
  // Codes are stored only as hashes.
  assert.equal(w.rows('SELECT * FROM ch_pairings WHERE code_hash = ?', code).length, 0);
  assert.equal((await w.device({ op: 'pair', code: 'ABCD-EFGH' })).status, 401);
  assert.equal((await w.device({ op: 'pair', code, name: 'x' }, { now: T0 + 11 * MIN })).status, 401);
  const ok = await w.device({
    op: 'pair',
    code: code.toLowerCase().replace('-', ' '),
    name: 'Amith phone',
    model: 'Pixel 8',
    android: 34,
  });
  assert.equal(ok.status, 200, ok.error);
  assert.match(ok.value.token, /^aekad_[a-f0-9]{32}\.[A-Za-z0-9_-]{20,}$/);
  assert.equal(ok.value.member.email, people.admin.email);
  // Used once only.
  assert.equal((await w.device({ op: 'pair', code })).status, 401);
  const token = ok.value.token;
  const stored = w.rows('SELECT * FROM ch_devices')[0];
  assert.ok(!JSON.stringify(stored).includes(token.split('.')[1]));
  assert.equal((await w.device(sync([]), { token })).status, 200);
  assert.equal((await w.device(sync([]), { token: token.slice(0, -2) + 'xx' })).status, 401);
  assert.equal((await w.device(sync([]))).status, 401);
  assert.equal((await w.device({ op: 'nope' }, { token })).status, 404);
  const { devices } = await w.action('phone.status', {});
  assert.deepEqual(
    devices.map((d) => [d.name, d.model, d.android, d.access.notifications]),
    [['Amith phone', 'Pixel 8', 34, true]],
  );
  // Only the owner sees or revokes it.
  assert.deepEqual((await w.action('phone.status', {}, T0, 'partner')).devices, []);
  await assert.rejects(
    w.action('phone.revoke', { deviceId: devices[0].id }, T0, 'partner'),
    /could not be found/,
  );
  await w.action('phone.revoke', { deviceId: devices[0].id });
  assert.equal((await w.device(sync([]), { token })).status, 401);
});

test('sync stores each message once, tracks who replied last, what was seen and which chats are live', async () => {
  const w = await world();
  const token = await w.pair();
  const first = msg({ id: 'a1', at: T0 - 30 * MIN, text: 'Hello Amith' });
  const second = msg({ id: 'a2', at: T0 - 20 * MIN });
  let r = await w.device(sync([first, second], { live: ['whatsapp:919812345678@s.whatsapp.net'] }), {
    token,
  });
  assert.equal(r.status, 200, r.error);
  assert.equal(r.value.accepted, 2);
  assert.equal(r.value.syncSeconds, 900);
  assert.equal(r.value.apps.whatsapp, true);
  // WhatsApp repeats the unread history: nothing new is stored.
  r = await w.device(sync([first, second]), { token });
  assert.equal(r.value.accepted, 0);
  assert.equal(w.rows('SELECT * FROM ch_messages').length, 2);
  let [t] = (await w.action('threads.list', { view: 'all' })).threads;
  assert.equal(t.title, 'Rahul Mehta');
  assert.equal(t.address, '919812345678');
  assert.equal(t.waitingSince, T0 - 30 * MIN);
  assert.equal(t.unanswered, 2);
  assert.equal(t.lastIn.text, 'Can you send the revised valuation note today?');
  assert.equal(t.live, false); // the second sync said no chat is live
  assert.equal(t.triage.status, 'pending');
  // Opened on the phone, then answered from the notification.
  await w.device(
    sync([{ type: 'cleared', app: 'whatsapp', chat: first.chat, at: T0 - 10 * MIN, reason: 'read' }]),
    { token },
  );
  await w.device(
    sync([msg({ id: 'a3', fromMe: true, sender: '', text: 'Sending shortly', at: T0 - 5 * MIN })]),
    { token },
  );
  [t] = (await w.action('threads.list', { view: 'all' })).threads;
  assert.equal(t.seenAt, T0 - 10 * MIN);
  assert.equal(t.lastOutAt, T0 - 5 * MIN);
  assert.equal(t.waitingSince, null);
  assert.equal(t.unanswered, 0);
  // Disabled apps are not stored; odd events are dropped one by one.
  await w.action('settings.update', {
    settings: { ...DEFAULT_SETTINGS, apps: { ...DEFAULT_SETTINGS.apps, slack: false } },
  });
  r = await w.device(
    sync([
      msg({ id: 'b1', app: 'slack', chat: 'slack:general', title: 'general' }),
      { type: 'message', app: 'whatsapp', chat: 'x', id: 'zz', text: 'bad id', at: T0 },
      { type: 'message', app: 'telegram', chat: 'x', id: 'a'.repeat(32), text: 'unknown app', at: T0 },
      msg({ id: 'b2', at: T0 + 3 * 86400000 }), // from the future
    ]),
    { token },
  );
  assert.equal(r.value.accepted, 0);
  assert.equal(r.value.dropped, 3);
  assert.equal(r.value.apps.slack, false);
  assert.equal((await w.device(sync(Array.from({ length: 201 }, () => msg())), { token })).status, 413);
});

test('reply state: the wait starts at the first message after my last reply', () => {
  const t = {
    id: 't',
    title: 'Rahul',
    group: false,
    muted: false,
    vip: false,
    lastInAt: T0 - 60 * MIN,
    lastInSender: 'Rahul',
    lastInText: 'x',
    lastOutAt: T0 - 30 * MIN,
    waitingSince: null,
    unanswered: 0,
    nudgeLevel: 2,
    triageStatus: 'done',
    nextAttemptAt: 0,
    attempts: 0,
  };
  const late = { fromMe: false, sender: 'Rahul', text: 'Any update?', at: T0 - 10 * MIN };
  const old = { fromMe: false, sender: 'Rahul', text: 'earlier', at: T0 - 40 * MIN };
  const s = replyState(t, [old, late], T0);
  assert.equal(s.waitingSince, T0 - 10 * MIN);
  assert.equal(s.unanswered, 1);
  assert.equal(s.nudgeLevel, 0);
  assert.equal(s.triageStatus, 'pending');
  assert.equal(s.nextAttemptAt, T0 + 90000);
  assert.equal(s.lastInText, 'Any update?');
  // A group waits 10 minutes before triage; a muted chat is never queued.
  assert.equal(replyState({ ...t, group: true }, [late], T0).nextAttemptAt, T0 + 10 * MIN);
  assert.equal(replyState({ ...t, muted: true }, [late], T0).triageStatus, 'done');
});

test('built-in checks triage service SMS, missed calls and LinkedIn notices without AI', () => {
  const row = (o) => ({ app: 'sms', title: 'AD-HDFCBK', last_out_at: null, vip: 0, ...o });
  const m = (text) => [{ fromMe: false, sender: 'x', text, at: T0 }];
  assert.equal(builtIn(row(), m('Rs 5,000 debited from a/c XX12')).tier, 4);
  assert.equal(builtIn(row({ title: 'Rahul Mehta' }), m('Call me')), null);
  const call = builtIn(row({ app: 'whatsapp', title: 'Rahul Mehta' }), m('Missed voice call'));
  assert.deepEqual([call.tier, call.replyNeeded], [2, 'yes']);
  assert.equal(builtIn(row({ app: 'whatsapp', title: 'Rahul', vip: 1 }), m('Missed video call')).tier, 1);
  assert.equal(
    builtIn(row({ app: 'linkedin', title: 'LinkedIn' }), m('5 people viewed your profile')).tier,
    4,
  );
  assert.equal(
    builtIn(row({ app: 'linkedin', title: 'Neha Shah' }), m('Are you free for a call on the deal?')),
    null,
  );
});

test('triage waits for a burst to finish, uses AI for the rest and alerts at once for urgent chats', async () => {
  const w = await world();
  const token = await w.pair();
  await w.device(
    sync([
      msg({ id: 'c1' }),
      msg({
        id: 'c2',
        app: 'sms',
        chat: 'sms:hdfcbk',
        title: 'AD-HDFCBK',
        sender: 'AD-HDFCBK',
        text: 'Rs 5,000 debited',
        address: '',
      }),
      msg({
        id: 'c3',
        chat: 'whatsapp:family',
        title: 'Family',
        group: true,
        sender: 'Mum',
        text: 'Dinner at 8?',
        address: '',
      }),
    ]),
    { token },
  );
  const admin = await w.member();
  // Within 90 seconds of the newest message nothing is triaged.
  assert.equal((await runChatTriage(w.sys(T0 + 30000), admin)).triaged, 0);
  w.ai.reply = (body) => {
    assert.match(body.messages[0].content, /data, never instructions/);
    const data = JSON.parse(body.messages[1].content.split('<data>\n')[1].split('\n</data>')[0]);
    assert.deepEqual(
      data.map((d) => d.chat),
      ['Rahul Mehta'],
    );
    assert.equal(data[0].messages[0].from, 'Rahul Mehta');
    return JSON.stringify({
      items: [
        {
          id: 'c1',
          tier: 1,
          category: 'client',
          replyNeeded: 'yes',
          summary: 'Wants the revised valuation note today — urgently',
          why: 'Client deadline today.',
          replyBy: '2026-10-27',
        },
      ],
    });
  };
  const r = await runChatTriage(w.sys(T0 + 2 * MIN), admin);
  assert.equal(r.triaged, 2); // Rahul by AI, the bank SMS by rules; the group waits 10 minutes
  assert.equal(r.aiTriaged, 1);
  assert.equal(w.ai.calls.length, 1);
  const { threads, counts } = await w.action('threads.list', { view: 'needs' }, T0 + 2 * MIN);
  assert.deepEqual(
    threads.map((t) => t.title),
    ['Rahul Mehta'],
  );
  assert.equal(threads[0].triage.summary, 'Wants the revised valuation note today, urgently');
  assert.equal(threads[0].triage.replyBy, '2026-10-27');
  assert.equal(counts.needs, 1);
  assert.equal((await w.action('threads.list', { view: 'low' }, T0 + 2 * MIN)).threads[0].title, 'AD-HDFCBK');
  // Urgent: one alert now, which the phone receives once.
  const urgent = w.rows("SELECT * FROM org_notifications WHERE kind = 'chats.urgent'");
  assert.equal(urgent.length, 1);
  assert.equal(urgent[0].title, 'Urgent: Rahul Mehta (WhatsApp)');
  assert.equal(urgent[0].link, `chats/inbox#${threads[0].id}`);
  const s1 = await w.device(sync([]), { token, now: T0 + 3 * MIN });
  assert.deepEqual(
    s1.value.notices.map((x) => x.title),
    ['Urgent: Rahul Mehta (WhatsApp)'],
  );
  assert.deepEqual((await w.device(sync([]), { token, now: T0 + 4 * MIN })).value.notices, []);
  // The group is triaged by AI after 10 minutes; a group chat needs no reply unless asked directly.
  w.ai.reply = () =>
    JSON.stringify({
      items: [
        {
          id: 'c1',
          tier: 3,
          category: 'personal',
          replyNeeded: 'no',
          summary: 'Dinner plans.',
          why: 'Social.',
          replyBy: null,
        },
      ],
    });
  await runChatTriage(w.sys(T0 + 11 * MIN), admin);
  assert.equal((await w.action('threads.list', { view: 'needs' }, T0 + 11 * MIN)).counts.pending, 0);
});

test('invalid AI answers are retried, then the chat is shown by rules so it is never missed', async () => {
  const w = await world();
  const token = await w.pair();
  await w.device(sync([msg({ id: 'd1' })]), { token });
  const admin = await w.member();
  w.ai.reply = () => JSON.stringify({ items: [{ id: 'c1', tier: 9 }] });
  let now = T0 + 2 * MIN;
  for (let i = 0; i < 3; i++) {
    await runChatTriage(w.sys(now), admin);
    now += 4 * HOUR;
  }
  assert.equal(w.ai.calls.length, 3);
  const [t] = (await w.action('threads.list', { view: 'needs' }, now)).threads;
  assert.equal(t.triage.source, 'rules');
  assert.equal(t.triage.replyNeeded, 'maybe');
  assert.match(t.triage.why, /could not be used/);
});

test('chats kept from AI, or with AI off, are triaged by rules and never drafted by AI', async () => {
  const w = await world();
  const token = await w.pair();
  await w.device(sync([msg({ id: 'e1', chat: 'whatsapp:mum', title: 'Mum', text: 'Call me when free' })]), {
    token,
  });
  const [t] = (await w.action('threads.list', { view: 'all' })).threads;
  const kept = await w.action('thread.update', { id: t.id, op: 'neverAi' }, T0 + 2 * MIN);
  assert.equal(kept.neverAi, true);
  assert.equal(kept.triage.source, 'rules');
  assert.equal(kept.triage.replyNeeded, 'maybe');
  assert.equal(w.ai.calls.length, 0);
  await assert.rejects(w.action('draft.create', { threadId: t.id }), /kept from AI/);
  assert.equal(w.ai.calls.length, 0);
  // The chat tool lists it without its content.
  const tool = await runTool({ ctx: await w.ctx(T0 + 3 * MIN), channel: 'web' }, 'phone_chats', '{}');
  const listed = JSON.parse(tool.content).result.chats;
  assert.deepEqual(
    listed.map((c) => [c.chat, c.about]),
    [['Mum', '(kept from AI)']],
  );
  assert.ok(!tool.content.includes('Call me when free'));
  // AI switched off for all chats.
  await w.action('settings.update', { settings: { ...DEFAULT_SETTINGS, ai: false } });
  await w.device(sync([msg({ id: 'e2' })]), { token });
  await runChatTriage(w.sys(T0 + 5 * MIN), await w.member());
  assert.equal(w.ai.calls.length, 0);
  const rahul = (await w.action('threads.list', { view: 'needs' }, T0 + 5 * MIN)).threads.find(
    (x) => x.title === 'Rahul Mehta',
  );
  assert.equal(rahul.triage.why, 'AI triage is off.');
});

test('nudges follow the tier schedule, hold in quiet hours and stop once I reply', async () => {
  assert.deepEqual(scheduleFor(2, false, false), [1, 6, 24]);
  assert.deepEqual(scheduleFor(2, true, false), [0.25, 2, 6]);
  assert.deepEqual(scheduleFor(3, false, true), [24, 72]);
  assert.equal(quietNow(ist('2026-10-27T22:30:00')), true);
  assert.equal(quietNow(ist('2026-10-27T07:00:00')), true);
  assert.equal(quietNow(ist('2026-10-27T07:30:00')), false);

  const w = await world();
  const token = await w.pair();
  const start = ist('2026-10-27T18:00:00');
  await w.device(sync([msg({ id: 'f1', at: start })]), { token, now: start });
  w.ai.reply = () =>
    JSON.stringify({
      items: [
        {
          id: 'c1',
          tier: 2,
          category: 'client',
          replyNeeded: 'yes',
          summary: 'Wants the valuation note.',
          why: 'Client request.',
          replyBy: null,
        },
      ],
    });
  const admin = await w.member();
  await runChatTriage(w.sys(start + 2 * MIN), admin);
  const nudges = () =>
    w.rows("SELECT title, body FROM org_notifications WHERE kind = 'chats.nudge' ORDER BY created_at");
  const run = (t) => runNudges(w.sys(t), people.admin.email, DEFAULT_SETTINGS);
  assert.equal(await run(start + 30 * MIN), 0);
  assert.equal(await run(start + 61 * MIN), 1);
  assert.equal(await run(start + 62 * MIN), 0); // once per level
  assert.equal(nudges()[0].title, 'Reply to Rahul Mehta (WhatsApp)');
  assert.equal(nudges()[0].body, 'Wants the valuation note. Waiting 1 hour.');
  // 6 hours later it is past midnight: held until 7:30 am, then only the latest level is sent.
  assert.equal(await run(start + 7 * HOUR), 0);
  assert.equal(await run(ist('2026-10-28T07:31:00')), 1);
  assert.equal(nudges().length, 2);
  assert.match(nudges()[1].title, /^Still waiting: Rahul Mehta/);
  // Opened on the phone: the next nudge says so. Then I reply: no more nudges.
  await w.device(
    sync([
      {
        type: 'cleared',
        app: 'whatsapp',
        chat: msg().chat,
        at: ist('2026-10-28T08:00:00'),
        reason: 'opened',
      },
    ]),
    {
      token,
      now: ist('2026-10-28T08:01:00'),
    },
  );
  assert.equal(await run(ist('2026-10-28T18:01:00')), 1);
  assert.match(nudges()[2].body, /You opened it on your phone at 28 Oct, 8:00 am/);
  const [t] = (await w.action('threads.list', { view: 'needs' }, ist('2026-10-28T18:02:00'))).threads;
  await w.action('thread.update', { id: t.id, op: 'replied' }, ist('2026-10-28T18:03:00'));
  assert.equal(await run(ist('2026-10-30T18:00:00')), 0);
  assert.equal(
    (await w.action('threads.list', { view: 'needs' }, ist('2026-10-30T18:00:00'))).threads.length,
    0,
  );
  assert.equal(
    (await w.action('threads.list', { view: 'waiting' }, ist('2026-10-30T18:00:00'))).threads.length,
    1,
  );
});

test('a draft is made on request, must lose its placeholders, and is recorded when the phone sends it', async () => {
  const w = await world();
  const token = await w.pair();
  await w.device(sync([msg({ id: 'g1' })]), { token });
  const [t] = (await w.action('threads.list', { view: 'all' })).threads;
  w.ai.reply = (body) => {
    assert.match(body.messages[0].content, /\[INPUT REQUIRED: what is needed\]/);
    assert.match(body.messages[1].content, /^My instructions: say yes/);
    return 'Here is a draft reply:\n"Yes Rahul — I will send it by [INPUT REQUIRED: time]."';
  };
  const d = await w.action('draft.create', { threadId: t.id, instructions: 'say yes' });
  assert.equal(d.text, 'Yes Rahul, I will send it by [INPUT REQUIRED: time].');
  await assert.rejects(
    w.action('draft.prepareSend', { draftId: d.id, text: d.text, baseRevision: d.revision }),
    /INPUT REQUIRED/,
  );
  const ready = await w.action('draft.prepareSend', {
    draftId: d.id,
    text: 'Yes Rahul, by 5 pm.',
    baseRevision: d.revision,
  });
  assert.equal(ready.chat, 'whatsapp:919812345678@s.whatsapp.net');
  assert.equal(ready.address, '919812345678');
  assert.equal(ready.app, 'whatsapp');
  await assert.rejects(
    w.action('draft.markSent', { draftId: d.id, how: 'notification', baseRevision: d.revision }),
    /changed since/,
  );
  const sent = await w.action(
    'draft.markSent',
    { draftId: d.id, how: 'notification', baseRevision: ready.draft.revision },
    T0 + MIN,
  );
  assert.equal(sent.status, 'sent');
  const got = await w.action('thread.get', { id: t.id }, T0 + MIN);
  assert.equal(got.thread.needsMe, false);
  assert.equal(got.thread.lastOutAt, T0 + MIN);
  assert.equal(got.draft, null);
  // Sent through the notification, the phone reports the message itself; nothing is added here.
  assert.equal(got.messages.length, 1);
  // Sent by hand: the reply is added to the chat.
  w.ai.reply = () => 'Thank you.';
  const d2 = await w.action('draft.create', { threadId: t.id });
  await w.action(
    'draft.markSent',
    { draftId: d2.id, how: 'manual', baseRevision: d2.revision },
    T0 + 2 * MIN,
  );
  const after = await w.action('thread.get', { id: t.id }, T0 + 2 * MIN);
  assert.deepEqual(after.messages.map((m) => [m.fromMe, m.text]).at(-1), [true, 'Thank you.']);
});

test('chats are private, feed the brief, become to-dos once, and can be deleted', async () => {
  const w = await world();
  const token = await w.pair();
  await w.device(sync([msg({ id: 'h1', text: 'Missed voice call' })]), { token });
  await chatsPass(w.sys(T0 + 2 * MIN), await w.member());
  const [t] = (await w.action('threads.list', { view: 'needs' }, T0 + 2 * MIN)).threads;
  assert.equal(t.triage.summary, 'Missed call from Rahul Mehta. Call back.');
  // Another member, administrators included, cannot see it.
  await assert.rejects(w.action('thread.get', { id: t.id }, T0, 'partner'), /could not be found/);
  assert.deepEqual((await w.action('threads.list', { view: 'all' }, T0, 'partner')).threads, []);
  // The brief lists it.
  const brief = await buildBrief(await w.ctx(T0 + 3 * MIN));
  const section = brief.sections.find((s) => s.title === 'Chats waiting for your reply');
  assert.deepEqual(section.lines, [
    {
      text: 'Rahul Mehta (WhatsApp, 8 minutes): Missed call from Rahul Mehta. Call back.',
      link: `chats/inbox#${t.id}`,
    },
  ]);
  // A to-do, once per wait.
  const { todoId } = await w.action('thread.toTodo', { id: t.id }, T0 + 3 * MIN);
  assert.ok(todoId);
  await assert.rejects(w.action('thread.toTodo', { id: t.id }, T0 + 4 * MIN), /already added/);
  const todo = w.rows('SELECT * FROM as_todos WHERE id = ?', todoId)[0];
  assert.equal(todo.source, 'phone');
  assert.equal(todo.priority, 'normal');
  // Delete everything.
  await assert.rejects(w.action('data.delete', {}), /Confirm/);
  await w.action('data.delete', { confirm: true });
  assert.equal(w.rows('SELECT count(*) AS n FROM ch_messages')[0].n, 0);
  assert.equal(w.rows('SELECT count(*) AS n FROM ch_threads')[0].n, 0);
});

test('the phone gets each kind of notice only when its switch is on, and on time for to-dos and reminders', async () => {
  const w = await world();
  const token = await w.pair();
  const ctx = await w.ctx(T0);
  const { createTodo } = await import('../modules/assistant/server/records.ts');
  const { notify } = await import('../core/server/notifications.ts');
  const todo = await createTodo(ctx, {
    title: 'File the TDS return',
    details: '',
    priority: 'normal',
    dueAt: T0 + 2 * HOUR,
  });
  // Upcoming: the to-do due in 2 hours, keyed like the notice raised when it falls due.
  let r = await w.device(sync([]), { token });
  assert.deepEqual(
    r.value.upcoming.map((u) => [u.key, u.at, u.title]),
    [[`todo.due:${todo.id}:${T0 + 2 * HOUR}`, T0 + 2 * HOUR, 'Due now: File the TDS return']],
  );
  // When it falls due, the workspace raises the same key.
  const { todoDueAlerts } = await import('../modules/assistant/server/tick.ts');
  assert.equal(await todoDueAlerts(w.sys(T0 + 2 * HOUR + MIN), await w.member()), 1);
  assert.equal(await todoDueAlerts(w.sys(T0 + 2 * HOUR + 2 * MIN), await w.member()), 0);
  r = await w.device(sync([]), { token, now: T0 + 2 * HOUR + 3 * MIN });
  assert.deepEqual(
    r.value.notices.map((n) => [n.kind, n.key]),
    [['todo.due', `todo.due:${todo.id}:${T0 + 2 * HOUR}`]],
  );
  // Switched off: the brief is not shown on the phone (and not later either), the rest still are.
  await w.action('settings.update', {
    settings: { ...DEFAULT_SETTINGS, alerts: { ...DEFAULT_SETTINGS.alerts, brief: false, todos: false } },
  });
  const at = T0 + 3 * HOUR;
  for (const [kind, key] of [
    ['brief', 'brief:1'],
    ['mail.action', 'mail.action:1'],
    ['mail.reauth', 'mail.reauth:1'],
  ])
    await notify(
      w.f.db,
      { recipient: people.admin.email, module: 'x', kind, title: kind, body: '', link: '', dedupeKey: key },
      at,
    );
  r = await w.device(sync([]), { token, now: at + MIN });
  assert.deepEqual(r.value.notices.map((n) => n.kind).sort(), ['mail.action', 'mail.reauth']);
  assert.deepEqual(r.value.upcoming, []);
  await w.action('settings.update', { settings: DEFAULT_SETTINGS });
  assert.deepEqual((await w.device(sync([]), { token, now: at + 2 * MIN })).value.notices, []);
  // Each phone gets its own copy.
  const second = await w.pair('admin', at + 2 * MIN);
  await notify(
    w.f.db,
    {
      recipient: people.admin.email,
      module: 'x',
      kind: 'reminder',
      title: 'Call bank',
      body: '',
      link: '',
      dedupeKey: 'r:9',
    },
    at + 3 * MIN,
  );
  assert.equal((await w.device(sync([]), { token, now: at + 4 * MIN })).value.notices.length, 1);
  assert.equal((await w.device(sync([]), { token: second, now: at + 4 * MIN })).value.notices.length, 1);
});

test('a chat that newly needs a reply alerts at once; a colleague is told of a task assigned to them', async () => {
  const w = await world();
  const token = await w.pair();
  await w.device(
    sync([
      msg({
        id: 'n1',
        chat: 'linkedin:neha',
        app: 'linkedin',
        title: 'Neha Shah',
        sender: 'Neha Shah',
        text: 'Free for a call this week?',
        address: '',
      }),
    ]),
    { token },
  );
  w.ai.reply = () =>
    JSON.stringify({
      items: [
        {
          id: 'c1',
          tier: 2,
          category: 'business',
          replyNeeded: 'yes',
          summary: 'Asks for a call this week.',
          why: 'Direct question.',
          replyBy: null,
        },
      ],
    });
  await runChatTriage(w.sys(T0 + 2 * MIN), await w.member());
  const action = w.rows("SELECT * FROM org_notifications WHERE kind = 'chats.action'");
  assert.deepEqual(
    action.map((a) => [a.title, a.body]),
    [['Needs your reply: Neha Shah (LinkedIn)', 'Asks for a call this week.']],
  );
  // Workflow: the associate hears about a task the admin assigns them; nobody hears about their own.
  const task = await w.f.ok('admin', 'task.create', {
    task: {
      matterId: w.f.open.id,
      title: 'Draft SPA comments',
      status: 'Preparing',
      assignee: people.associate.email,
      preparedBy: null,
      reviewedBy: null,
      dueDate: '2026-10-30',
      priority: false,
      notes: '',
      steps: [],
    },
  });
  const assigned = w.rows("SELECT * FROM org_notifications WHERE kind = 'task.assigned'");
  assert.deepEqual(
    assigned.map((a) => [a.recipient, a.title, a.link]),
    [[people.associate.email, 'New task: Draft SPA comments', `workflow/matters#${w.f.open.id}`]],
  );
  assert.match(assigned[0].body, /^Amith Rao assigned it to you on Project Falcon, due 2026-10-30\.$/);
  await w.f.ok('admin', 'task.update', {
    id: task.id,
    task: { ...task, title: 'Draft SPA comments v2' },
    baseRevision: task.revision,
  });
  assert.equal(w.rows("SELECT * FROM org_notifications WHERE kind = 'task.assigned'").length, 1);
});

test('text of chats kept from AI, or with AI off, never reaches the brief, Ask Aeka, drafts or to-dos', async () => {
  const w = await world();
  const token = await w.pair();
  await w.device(
    sync([msg({ id: 'p1', chat: 'whatsapp:mum', title: 'Mum', text: 'Private family matter' })]),
    { token },
  );
  const [t] = (await w.action('threads.list', { view: 'all' })).threads;
  await w.action('thread.update', { id: t.id, op: 'neverAi' }, T0 + 2 * MIN);
  const brief = await buildBrief(await w.ctx(T0 + 3 * MIN));
  const text = JSON.stringify(brief);
  assert.ok(text.includes('Mum (WhatsApp'));
  assert.ok(!text.includes('Private family matter'));
  const { todoId } = await w.action('thread.toTodo', { id: t.id }, T0 + 3 * MIN);
  assert.equal(w.rows('SELECT title FROM as_todos WHERE id = ?', todoId)[0].title, 'Reply to Mum (WhatsApp)');
  // AI off for chats: the same for every chat, and no drafts.
  await w.action('settings.update', { settings: { ...DEFAULT_SETTINGS, ai: false } });
  await w.device(sync([msg({ id: 'p2', text: 'Client secret figures' })]), { token });
  await runChatTriage(w.sys(T0 + 5 * MIN), await w.member());
  const rahul = (await w.action('threads.list', { view: 'all' }, T0 + 5 * MIN)).threads.find(
    (x) => x.title === 'Rahul Mehta',
  );
  await assert.rejects(w.action('draft.create', { threadId: rahul.id }, T0 + 5 * MIN), /switched off/);
  const tool = await runTool({ ctx: await w.ctx(T0 + 6 * MIN), channel: 'web' }, 'phone_chats', '{}');
  assert.ok(!tool.content.includes('Client secret figures'));
  assert.equal(w.ai.calls.length, 0);
});

test('many live chats sync in one statement; a refused pairing leaves the code usable', async () => {
  const w = await world();
  const token = await w.pair();
  const chats = Array.from({ length: 120 }, (_, i) => `whatsapp:${i}`);
  await w.device(sync(chats.slice(0, 60).map((c, i) => msg({ id: `l${i}`, chat: c, title: `Chat ${i}` }))), {
    token,
  });
  const r = await w.device(sync([], { live: chats }), { token });
  assert.equal(r.status, 200, r.error);
  assert.equal(w.rows('SELECT count(*) AS n FROM ch_threads WHERE live = 1')[0].n, 60);
  // Five phones are the most; the code of a refused sixth is not used up.
  for (let i = 0; i < 4; i++) await w.pair();
  const { code } = await w.action('phone.pairingCode', {});
  assert.equal((await w.device({ op: 'pair', code })).status, 409);
  const [d] = (await w.action('phone.status', {})).devices;
  await w.action('phone.revoke', { deviceId: d.id });
  assert.equal((await w.device({ op: 'pair', code })).status, 200);
});
