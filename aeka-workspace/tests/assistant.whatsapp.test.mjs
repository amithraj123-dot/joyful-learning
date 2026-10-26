import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { getMember } from '../core/server/members.ts';
import { notify } from '../core/server/notifications.ts';
import { assistantServer } from '../modules/assistant/server/index.ts';
import { whatsappWebhook } from '../modules/assistant/server/whatsapp.ts';
import { firm, people } from './fixtures/workflow-firm.mjs';

const SECRET = 'meta-app-secret';
const PHONE = '919876543210';
const env = {
  LITELLM_BASE_URL: 'https://llm.example/v1',
  LITELLM_API_KEY: 'k',
  WHATSAPP_ENABLED: 'true',
  WHATSAPP_APP_SECRET: SECRET,
  WHATSAPP_VERIFY_TOKEN: 'verify-token-123456',
  WHATSAPP_ACCESS_TOKEN: 'wa-access-token',
  WHATSAPP_PHONE_NUMBER_ID: '10001',
  WHATSAPP_GRAPH_VERSION: 'v23.0',
};
const HOUR = 3600000;

// Fake Meta Graph API and LiteLLM. `graph.reply` decides how sends are answered.
function services() {
  const sent = [];
  const llm = [];
  let k = 0;
  const graph = {
    reply: () => Response.json({ messages: [{ id: 'wamid.out' + ++k }] }),
  };
  const fetcher = async (url, init = {}) => {
    const u = String(url);
    if (u.endsWith('/chat/completions')) {
      const body = JSON.parse(init.body);
      llm.push(body);
      const tool = body.messages.some((m) => m.role === 'tool');
      const message = tool
        ? { role: 'assistant', content: 'Added to your to-dos.' }
        : {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'create_todo', arguments: '{"title":"Send the CP list"}' },
              },
            ],
          };
      return Response.json({
        choices: [{ message, finish_reason: tool ? 'stop' : 'tool_calls' }],
        usage: {},
      });
    }
    if (u.includes('?fields=display_phone_number'))
      return Response.json({ display_phone_number: '+91 80 4000 0000' });
    if (u === 'https://graph.facebook.com/v23.0/10001/messages') {
      assert.equal(init.headers.Authorization, 'Bearer wa-access-token');
      sent.push(JSON.parse(init.body));
      return graph.reply();
    }
    throw new Error('Unexpected request to ' + u);
  };
  return { sent, llm, graph, fetcher };
}

const signed = (body, secret = SECRET) => {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request('https://aeka.example/api/whatsapp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex'),
    },
    body: raw,
  });
};
const change = (value) => ({
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '10001' }, ...value } }] }],
});
const message = (id, text, from = PHONE, type = 'text') =>
  change({
    messages: [
      {
        id,
        from,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type,
        ...(type === 'text' ? { text: { body: text } } : {}),
      },
    ],
  });
const statuses = (...list) =>
  change({ statuses: list.map(([id, status]) => ({ id, status, recipient_id: PHONE })) });

async function setup(over = {}) {
  const s = services();
  const f = await firm({ env: { ...env, ...over }, fetcher: s.fetcher });
  const sys = () => ({ db: f.db, env: f.options.env, fetch: s.fetcher, now: Date.now() });
  const later = [];
  const hook = async (request, defer = true) => {
    const r = await whatsappWebhook(request, sys(), defer ? { defer: (p) => later.push(p) } : {});
    await Promise.all(later.splice(0));
    return r;
  };
  const member = await getMember(f.db, people.associate.email);
  // The morning brief is covered elsewhere; off here so only the messages under test are queued.
  await f.send('associate', 'assistant', 'settings.save', {
    settings: {
      briefEnabled: false,
      briefTime: '08:30',
      alerts: { reminders: true, brief: true, urgentMail: true },
    },
  });
  const tick = (now = Date.now()) => assistantServer.tick({ ...sys(), now }, { member });
  const outbox = () => f.db.sql.prepare('SELECT * FROM as_outbox ORDER BY created_at, rowid').all();
  const settings = () => f.db.sql.prepare('SELECT * FROM as_settings WHERE member = ?').get(member.email);
  const a = (who, action, payload) => f.send(who, 'assistant', action, payload);
  const link = async () => {
    const code = (await a('associate', 'whatsapp.link', {})).value.code;
    await hook(signed(message('wamid.link1', `link ${code.slice(0, 4)}-${code.slice(4).toLowerCase()}`)));
  };
  return { ...f, ...s, sys, hook, tick, outbox, settings, a, link, member };
}

test('GET verifies the subscription with the verify token; nothing works when WhatsApp is off', async () => {
  const { hook, sys } = await setup();
  const get = (q) =>
    new Request('https://aeka.example/api/whatsapp?' + new URLSearchParams(q), { method: 'GET' });
  const good = await hook(
    get({ 'hub.mode': 'subscribe', 'hub.verify_token': env.WHATSAPP_VERIFY_TOKEN, 'hub.challenge': '4242' }),
  );
  assert.equal(good.status, 200);
  assert.equal(await good.text(), '4242');
  assert.equal(
    (await hook(get({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '1' }))).status,
    403,
  );
  assert.equal(
    (await hook(get({ 'hub.mode': 'unsubscribe', 'hub.verify_token': env.WHATSAPP_VERIFY_TOKEN }))).status,
    403,
  );
  const off = await whatsappWebhook(get({}), { ...sys(), env: { ...env, WHATSAPP_ENABLED: 'false' } });
  assert.equal(off.status, 404);
});

test('a bad signature is refused with 401 before anything is read or stored', async () => {
  const { hook, db } = await setup();
  assert.equal((await hook(signed(message('wamid.x', 'hello'), 'another-secret'))).status, 401);
  const unsigned = new Request('https://aeka.example/api/whatsapp', { method: 'POST', body: '{}' });
  assert.equal((await hook(unsigned)).status, 401);
  assert.equal(db.sql.prepare('SELECT count(*) AS n FROM as_whatsapp_events').get().n, 0);
  assert.equal((await hook(signed('not json'))).status, 400);
});

test('LINK with a valid code links the number once and confirms; duplicates and unknown numbers are ignored', async () => {
  const { a, hook, outbox, settings, sent, db, link } = await setup();
  const start = await a('associate', 'whatsapp.link', {});
  assert.equal(start.status, 200);
  assert.match(start.value.code, /^[A-Z2-9]{8}$/);
  assert.equal(start.value.businessNumber, '+91 80 4000 0000');
  assert.ok(start.value.expiresAt > Date.now() + 14 * 60000);
  // The code is stored only as a hash.
  assert.notEqual(settings().link_code, start.value.code);
  // A wrong code from an unknown number: ignored, no reply.
  await hook(signed(message('wamid.bad', 'LINK ZZZZZZZZ')));
  assert.equal(outbox().length, 0);
  await link();
  assert.equal(settings().whatsapp_phone, PHONE);
  assert.equal(settings().link_code, null);
  const [confirm] = outbox();
  assert.equal(confirm.status, 'accepted');
  assert.equal(confirm.provider_id, 'wamid.out1');
  assert.match(confirm.body, /now linked to Aeka Workspace for Asha Verma/);
  assert.equal(sent[0].to, PHONE);
  assert.equal(sent[0].type, 'text');
  // The same provider message again does nothing.
  await hook(signed(message('wamid.link1', 'LINK whatever')));
  assert.equal(outbox().length, 1);
  const status = (await a('associate', 'settings.get', {})).value.whatsapp;
  assert.deepEqual(status, {
    available: true,
    businessNumber: '',
    linked: true,
    phoneMasked: '•••• 3210',
    replyWindowOpen: true,
  });
  // Other text from unknown numbers is ignored without a reply.
  await hook(signed(message('wamid.u1', 'What are my tasks?', '447700900123')));
  assert.equal(outbox().length, 1);
  const ev = db.sql.prepare("SELECT status, body FROM as_whatsapp_events WHERE id = 'wamid.u1'").get();
  assert.deepEqual({ ...ev }, { status: 'ignored', body: '' });
});

test('text from a linked number runs the chat loop and the reply is sent back', async () => {
  const { hook, outbox, sent, llm, link, a, db } = await setup();
  await link();
  await hook(signed(message('wamid.m1', 'Add a to-do to send the CP list')));
  assert.equal(llm.length, 2);
  assert.match(llm[0].messages[0].content, /on WhatsApp/);
  const todos = (await a('associate', 'todos.list', {})).value;
  assert.equal(todos.length, 1);
  assert.equal(todos[0].source, 'whatsapp');
  const reply = outbox()[1];
  assert.equal(reply.status, 'accepted');
  assert.match(reply.body, /Added to your to-dos\.\n\nDone: Created to-do: Send the CP list/);
  assert.equal(sent.length, 2);
  const conv = (await a('associate', 'chat.list', {})).value;
  assert.equal(conv.length, 1);
  assert.equal(conv[0].channel, 'whatsapp');
  // The inbound text is not kept once answered.
  assert.equal(
    db.sql.prepare("SELECT body, status FROM as_whatsapp_events WHERE id = 'wamid.m1'").get().body,
    '',
  );
  // Web replies into the WhatsApp conversation are refused.
  assert.equal((await a('associate', 'chat.send', { conversationId: conv[0].id, text: 'hi' })).status, 409);
});

test('without waitUntil a message waits for the tick, which answers it once', async () => {
  const { hook, outbox, llm, link, tick } = await setup();
  await link();
  await hook(signed(message('wamid.q1', 'Add a to-do')), false);
  assert.equal(llm.length, 0);
  await tick();
  assert.equal(llm.length, 2);
  assert.equal(outbox().length, 2);
  await tick(Date.now() + 61000);
  assert.equal(llm.length, 2);
});

test('STOP unlinks the number, cancels queued alerts and replies once', async () => {
  const { hook, outbox, settings, link, sent, db, member } = await setup();
  await link();
  db.sql
    .prepare(
      "INSERT INTO as_outbox(id,member,phone,body,status,provider_id,error,created_at,updated_at) VALUES('q1',?,?,'Queued alert','queued',NULL,'',?,?)",
    )
    .run(member.email, PHONE, Date.now(), Date.now());
  await hook(signed(message('wamid.s1', 'STOP')));
  assert.equal(settings().whatsapp_phone, null);
  const rows = outbox();
  assert.equal(rows.find((r) => r.id === 'q1').status, 'failed');
  const stop = rows[rows.length - 1];
  assert.match(stop.body, /alerts to this number have stopped/);
  assert.equal(stop.status, 'accepted');
  assert.equal(sent.length, 2);
  await hook(signed(message('wamid.s2', 'unsubscribe')));
  assert.equal(outbox().length, rows.length);
});

test('delivery statuses never move backwards, even when they arrive early or out of order', async () => {
  const { hook, outbox, link } = await setup();
  await link();
  const id = outbox()[0].provider_id;
  await hook(signed(statuses([id, 'read'])));
  await hook(signed(statuses([id, 'delivered'], [id, 'sent'])));
  assert.equal(outbox()[0].status, 'read');
  await hook(signed(statuses([id, 'failed'])));
  assert.equal(outbox()[0].status, 'read');
  // A status for a message whose send response has not been stored yet is applied once it is.
  await hook(signed(statuses(['wamid.out2', 'delivered'])));
  await hook(signed(message('wamid.m2', 'Add a to-do')));
  const reply = outbox().find((r) => r.provider_id === 'wamid.out2');
  assert.equal(reply.status, 'delivered');
});

test('chosen notices go to WhatsApp once; outside the 24-hour window only through the template', async () => {
  const { link, tick, outbox, sent, db, member, options } = await setup();
  const before = await notify(db, {
    recipient: member.email,
    module: 'assistant',
    kind: 'reminder',
    title: 'Before linking',
    body: '',
    link: '',
  });
  assert.ok(before);
  await new Promise((r) => setTimeout(r, 5));
  await link();
  const base = {
    recipient: member.email,
    module: 'assistant',
    link: 'assistant/todos',
    body: 'Due 27 Oct 2026, 3:00 pm.',
  };
  await notify(db, { ...base, kind: 'reminder', title: 'Call Rahul' });
  await notify(db, { ...base, kind: 'scribe.done', title: 'Not an alert kind' });
  await tick();
  let rows = outbox();
  assert.equal(rows.length, 2);
  assert.equal(rows[1].body, 'Call Rahul\nDue 27 Oct 2026, 3:00 pm.');
  assert.equal(rows[1].status, 'accepted');
  assert.equal(sent[1].type, 'text');
  const delivered = db.sql
    .prepare("SELECT delivered FROM org_notifications WHERE title = 'Call Rahul'")
    .get();
  assert.equal(delivered.delivered, 'whatsapp');
  await tick(Date.now() + 61000);
  assert.equal(outbox().length, 2);
  // More than 24 hours since the member last wrote: no template configured, so it fails clearly.
  db.sql
    .prepare('UPDATE as_settings SET last_inbound_at = ? WHERE member = ?')
    .run(Date.now() - 25 * HOUR, member.email);
  await notify(db, { ...base, kind: 'reminder', title: 'Window closed' });
  await tick(Date.now() + 2 * 61000);
  rows = outbox();
  assert.equal(rows[2].status, 'failed');
  assert.match(rows[2].error, /24 hours.*template/);
  // With an approved template the alert goes as its single body parameter, on one line.
  options.env = {
    ...options.env,
    WHATSAPP_NOTIFICATION_TEMPLATE: 'aeka_alert',
    WHATSAPP_TEMPLATE_LANGUAGE: 'en_GB',
  };
  await notify(db, { ...base, kind: 'reminder', title: 'Template alert' });
  await tick(Date.now() + 3 * 61000);
  const last = sent[sent.length - 1];
  assert.equal(last.type, 'template');
  assert.equal(last.template.name, 'aeka_alert');
  assert.equal(last.template.language.code, 'en_GB');
  assert.equal(last.template.components[0].parameters[0].text, 'Template alert; Due 27 Oct 2026, 3:00 pm.');
  assert.equal(outbox()[3].status, 'accepted');
});

test('a send that times out is recorded as uncertain and never retried automatically', async () => {
  const { link, tick, outbox, graph, db, member, sent } = await setup();
  await link();
  graph.reply = () => {
    throw new DOMException('The operation timed out.', 'TimeoutError');
  };
  await notify(db, {
    recipient: member.email,
    module: 'assistant',
    kind: 'reminder',
    title: 'Call',
    body: '',
    link: '',
  });
  await tick();
  const row = outbox()[1];
  assert.equal(row.status, 'uncertain');
  assert.match(row.error, /could not be confirmed/);
  const attempts = sent.length;
  await tick(Date.now() + 61000);
  assert.equal(sent.length, attempts);
  // A refusal is recorded as failed with the reason.
  graph.reply = () => Response.json({ error: { message: 'Recipient not on WhatsApp' } }, { status: 400 });
  await notify(db, {
    recipient: member.email,
    module: 'assistant',
    kind: 'reminder',
    title: 'Call 2',
    body: '',
    link: '',
  });
  await tick(Date.now() + 2 * 61000);
  assert.match(outbox()[2].error, /refused the message \(HTTP 400\): Recipient not on WhatsApp/);
});

test('unlinking from settings stops alerts; a deactivated member gets no answers', async () => {
  const { link, a, settings, hook, llm, outbox, send } = await setup();
  await link();
  assert.equal((await a('associate', 'whatsapp.unlink', {})).value, true);
  assert.equal(settings().whatsapp_phone, null);
  await link();
  await send('admin', 'core', 'members.save', {
    member: {
      email: people.associate.email,
      name: people.associate.name,
      designation: 'Associate',
      active: false,
    },
  });
  const count = outbox().length;
  await hook(signed(message('wamid.d1', 'Add a to-do')));
  assert.equal(llm.length, 0);
  assert.equal(outbox().length, count);
});
