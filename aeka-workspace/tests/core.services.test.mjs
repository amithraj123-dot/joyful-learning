import test from 'node:test';
import assert from 'node:assert/strict';
import { chat, parseJsonObject, usedToday } from '../core/server/ai.ts';
import { notify, listNotices, takeLease } from '../core/server/notifications.ts';
import { seal, unseal, sealingAvailable, sameSecret } from '../core/server/secrets.ts';
import { runTicks } from '../core/server/tick.ts';
import { database } from './helpers/database.mjs';
import { firm } from './fixtures/workflow-firm.mjs';

const KEY = 'a'.repeat(64);
const aiEnv = { LITELLM_BASE_URL: 'https://llm.example/v1', LITELLM_API_KEY: 'k', AEKA_AI_DAILY_LIMIT: '2' };
const completion = (content) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 7, completion_tokens: 3 },
    }),
    { status: 200 },
  );

test('sealed values open only with the same key, purpose and record', async () => {
  const env = { AEKA_ENCRYPTION_KEY: KEY };
  assert.equal(sealingAvailable(env), true);
  assert.equal(sealingAvailable({}), false);
  assert.equal(sealingAvailable({ AEKA_ENCRYPTION_KEY: 'short' }), false);
  const sealed = await seal(env, 'mail-token', 'a@x', 'refresh-123');
  assert.ok(!sealed.includes('refresh-123'));
  assert.equal(await unseal(env, 'mail-token', 'a@x', sealed), 'refresh-123');
  await assert.rejects(unseal(env, 'mail-token', 'b@x', sealed), /could not be opened/);
  await assert.rejects(unseal(env, 'other', 'a@x', sealed), /could not be opened/);
  await assert.rejects(
    unseal({ AEKA_ENCRYPTION_KEY: 'b'.repeat(64) }, 'mail-token', 'a@x', sealed),
    /could not be opened/,
  );
  await assert.rejects(seal({}, 'mail-token', 'a@x', 'x'), /AEKA_ENCRYPTION_KEY/);
  assert.equal(sameSecret('abc', 'abc'), true);
  assert.equal(sameSecret('abc', 'abd'), false);
  assert.equal(sameSecret('abc', 'abcd'), false);
});

test('the AI client meters every call, failed ones included, and enforces the daily limit', async () => {
  const db = database();
  const calls = [];
  let reply = () => completion('{"ok":true}');
  const deps = {
    db,
    env: aiEnv,
    now: Date.now(),
    fetch: async (url, init) => (calls.push({ url, body: JSON.parse(init.body) }), reply()),
  };
  const req = {
    purpose: 'triage',
    module: 'mail',
    actor: 'a@x',
    model: 'fast',
    json: true,
    messages: [{ role: 'user', content: 'hi' }],
  };
  const r = await chat(deps, req);
  assert.equal(r.message.content, '{"ok":true}');
  assert.equal(calls[0].url, 'https://llm.example/v1/chat/completions');
  assert.equal(calls[0].body.model, 'claude-sonnet-4.6');
  assert.deepEqual(calls[0].body.response_format, { type: 'json_object' });
  reply = () => new Response('nope', { status: 401 });
  await assert.rejects(chat(deps, req), /LITELLM_API_KEY/);
  assert.equal(await usedToday(db, 'a@x', deps.now), 2);
  await assert.rejects(chat(deps, req), /allowance for today/);
  assert.equal(calls.length, 2); // the limit stops the third call before anything is sent
  const rows = db.sql.prepare('SELECT ok, prompt_tokens, error FROM ai_usage ORDER BY at, ok DESC').all();
  assert.deepEqual(rows.map((x) => x.ok).sort(), [0, 1]);
  // Unconfigured, switched off, or plain HTTP to a remote host: nothing is sent.
  await assert.rejects(chat({ ...deps, env: {} }, req), /not configured/);
  await assert.rejects(chat({ ...deps, env: { ...aiEnv, AEKA_AI_DISABLED: 'true' } }, req), /switched off/);
  await assert.rejects(
    chat({ ...deps, env: { ...aiEnv, LITELLM_BASE_URL: 'http://llm.example' } }, { ...req, actor: 'b@x' }),
    /HTTPS/,
  );
  assert.equal(calls.length, 2);
});

test('model JSON is read from fenced or wrapped replies, and junk is refused', () => {
  assert.deepEqual(parseJsonObject('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonObject('Here you go: {"a":{"b":2}} thanks'), { a: { b: 2 } });
  assert.equal(parseJsonObject('[1,2]'), null);
  assert.equal(parseJsonObject('not json'), null);
  assert.equal(parseJsonObject(null), null);
});

test('notifications are idempotent per dedupe key and private to their recipient', async () => {
  const { ok, send, db } = await firm();
  const base = {
    recipient: 'asha@aeka.example',
    module: 'assistant',
    kind: 'reminder',
    title: 'Call Rahul',
    body: '',
    link: 'assistant/todos',
  };
  assert.ok(await notify(db, { ...base, dedupeKey: 'r1' }));
  assert.equal(await notify(db, { ...base, dedupeKey: 'r1' }), null);
  assert.ok(await notify(db, { ...base, recipient: 'mona@aeka.example', dedupeKey: 'r1' }));
  const mine = await send('associate', 'core', 'notifications.list', {});
  assert.equal(mine.value.items.length, 1);
  assert.equal(mine.value.unread, 1);
  await send('associate', 'core', 'notifications.read', { ids: 'all' });
  assert.equal((await send('associate', 'core', 'notifications.list', {})).value.unread, 0);
  assert.equal((await send('manager', 'core', 'notifications.list', {})).value.unread, 1);
  assert.equal((await listNotices(db, 'mona@aeka.example')).length, 1);
  void ok;
});

test('background ticks run each module once per member, isolate failures and never overlap', async () => {
  const db = database();
  const now = Date.now();
  db.sql
    .prepare(
      "INSERT INTO org_members(email,name,initials,designation,is_admin,active,created_at,updated_at) VALUES('a@x','A','A','Partner',1,1,0,0),('b@x','B','B','Associate',0,1,0,0),('c@x','C','C','Article',0,0,0,0)",
    )
    .run();
  const seen = [];
  const modules = [
    { id: 'one', actions: {}, tick: async (_s, { member }) => void seen.push('one:' + member.email) },
    {
      id: 'broken',
      actions: {},
      tick: async () => {
        throw new Error('boom');
      },
    },
    { id: 'none', actions: {} },
  ];
  const sys = { db, env: {}, fetch, now };
  const r = await runTicks(sys, modules);
  assert.deepEqual(r, { ran: true, failures: ['broken'] });
  assert.deepEqual(seen.sort(), ['one:a@x', 'one:b@x']);
  // A member's own tick runs at most once a minute.
  const member = { email: 'a@x', active: true };
  assert.equal((await runTicks(sys, modules, member)).ran, true);
  assert.equal((await runTicks(sys, modules, member)).ran, false);
  assert.equal((await runTicks({ ...sys, now: now + 61000 }, modules, member)).ran, true);
  assert.equal(await takeLease(db, 'x', now, 1000), true);
  assert.equal(await takeLease(db, 'x', now + 10, 1000), false);
});

test('integration status shows what is configured, never the values, and only to administrators', async () => {
  const env = {
    ...aiEnv,
    AEKA_ENCRYPTION_KEY: KEY,
    MS_CLIENT_ID: 'id',
    MS_CLIENT_SECRET: 'secret',
    AEKA_TICK_TOKEN: 't'.repeat(30),
  };
  const { send } = await firm({ env });
  assert.equal((await send('manager', 'core', 'integrations.status', {})).status, 403);
  const r = await send('admin', 'core', 'integrations.status', {});
  assert.equal(r.status, 200);
  assert.equal(r.value.ai.ready, true);
  assert.equal(r.value.secureStorage, true);
  assert.equal(r.value.outlook, true);
  assert.equal(r.value.scheduler, true);
  assert.equal(r.value.whatsapp, false);
  assert.ok(!JSON.stringify(r.value).includes('secret'));
});
