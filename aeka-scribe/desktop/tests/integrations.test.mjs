import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createIntegrations,
  validateAction,
  emailAddresses,
  mailMIME,
  zapierURL,
} from '../services/integrations.mjs';
import { createCalendars, optionalScopes } from '../services/calendars.mjs';
const vault = () => {
  const m = new Map();
  return {
    read: async (k, f) => structuredClone(m.has(k) ? m.get(k) : f),
    write: async (k, v) => m.set(k, structuredClone(v)),
  };
};
const note = { id: 'one', title: 'Review', updatedAt: 1, details: { trashedAt: 0 } };
const action = {
  provider: 'slack',
  noteId: 'one',
  title: 'Decisions',
  body: 'Keep the budget at 500. Do not increase it.',
  target: 'C0123456789',
};
const json = (d) => new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json' } });
const setup = async (fetcher) => {
  const v = vault(),
    calls = [],
    state = { note: structuredClone(note), account: 'account1', allowed: true };
  const s = createIntegrations({
    vault: v,
    workspace: { list: async () => (state.note ? [state.note] : []) },
    calendars: {
      access: async () => ({ token: 'private-oauth', email: 'me@example.test', connectionId: state.account }),
    },
    permitted: () => state.allowed,
    fetcher: async (url, init) => {
      calls.push({ url: String(url), ...init });
      return fetcher
        ? fetcher(url, init)
        : json({ ok: true, channel: { id: action.target, name: 'planning' }, ts: '123.456' });
    },
  });
  await s.configure({ provider: 'slack', secret: 'xoxb-private-test', label: 'Acme' });
  return { s, v, calls, state };
};
test('drafts verify the target with reads, freeze exact text and send only once after review', async () => {
  const { s, calls } = await setup();
  const d = await s.prepare(action);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.match(d.targetLabel, /#planning/);
  assert.equal(JSON.stringify(d).includes('private-test'), false);
  await assert.rejects(s.commit({ id: d.id }), /Review/);
  assert.equal(calls.length, 1);
  const r = await s.commit({ id: d.id, reviewed: true });
  assert.equal(r.state, 'sent');
  assert.equal(JSON.parse(calls[1].body).text, 'Decisions\n\n' + action.body);
  assert.equal(JSON.parse(calls[1].body).mrkdwn, false);
  await assert.rejects(s.commit({ id: d.id, reviewed: true }), /already/);
  await assert.rejects(s.prepare(action), /already sent/);
  assert.equal(calls.filter((x) => x.method === 'POST').length, 1);
  assert.equal((await s.list())[0].body, '');
});
test('two previews cannot commit the same action concurrently', async () => {
  const { s, calls } = await setup(),
    a = await s.prepare(action),
    b = await s.prepare(action);
  const outcomes = await Promise.allSettled([
    s.commit({ id: a.id, reviewed: true }),
    s.commit({ id: b.id, reviewed: true }),
  ]);
  assert.equal(outcomes.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(calls.filter((x) => x.method === 'POST').length, 1);
});
test('note edits, trash, policy and account changes block a previously reviewed send', async () => {
  const { s, state, calls } = await setup();
  let d = await s.prepare(action);
  state.note.updatedAt++;
  await assert.rejects(s.commit({ id: d.id, reviewed: true }), /source note changed/i);
  d = await s.prepare(action);
  state.note.details.trashedAt = 1;
  await assert.rejects(s.commit({ id: d.id, reviewed: true }), /source note changed/i);
  state.note.details.trashedAt = 0;
  d = await s.prepare({ ...action, provider: 'gmail', target: 'person@example.test' });
  state.account = 'account2';
  await assert.rejects(s.commit({ id: d.id, reviewed: true }), /connection changed/i);
  state.allowed = false;
  await assert.rejects(s.prepare(action), /policy/);
  assert.equal(calls.filter((x) => x.method === 'POST').length, 0);
});
test('connection replacement invalidates previews and secrets never enter public status or history', async () => {
  const { s } = await setup(),
    d = await s.prepare(action);
  await s.configure({ provider: 'slack', secret: 'new-secret-token', label: 'Another account' });
  await assert.rejects(s.commit({ id: d.id, reviewed: true }), /connection changed/);
  assert.doesNotMatch(JSON.stringify([await s.status(), await s.list()]), /secret-token|private-test/);
});
test('timeouts, server errors and lost receipts remain uncertain and are never replayed', async () => {
  for (const mode of ['timeout', 'server', 'invalid']) {
    const { s, calls } = await setup((_url, init) =>
      init.method === 'GET'
        ? json({ ok: true, channel: { id: action.target, name: 'planning' } })
        : mode === 'timeout'
          ? Promise.reject(Error('secret-network-detail'))
          : mode === 'server'
            ? new Response('', { status: 502 })
            : new Response('bad'),
    );
    const d = await s.prepare(action),
      r = await s.commit({ id: d.id, reviewed: true });
    assert.equal(r.state, 'uncertain');
    assert.doesNotMatch(r.error, /secret-network/);
    await assert.rejects(s.prepare(action), /already uncertain/);
    await s.recover();
    assert.equal(calls.filter((x) => x.method === 'POST').length, 1);
  }
});
test('Slack 200 with ok false is a rejection, not a successful send', async () => {
  const { s } = await setup((_u, i) =>
    i.method === 'GET'
      ? json({ ok: true, channel: { id: action.target, name: 'planning' } })
      : json({ ok: false, error: 'missing_scope' }),
  );
  const d = await s.prepare(action),
    r = await s.commit({ id: d.id, reviewed: true });
  assert.equal(r.state, 'rejected');
});
test('startup recovery marks in-flight sends uncertain and erases stored message bodies', async () => {
  const { s, v } = await setup();
  await v.write('outbox', [
    { ...action, id: 'pending', state: 'sending', createdAt: 1, body: 'private message' },
  ]);
  await s.recover();
  const [d] = await s.list();
  assert.equal(d.state, 'uncertain');
  assert.equal(d.body, '');
});
test('email encoding preserves unicode and rejects header injection, oversized recipients and unsafe hooks', () => {
  assert.throws(() => emailAddresses('ok@example.test\r\nBcc: evil@example.test'));
  assert.throws(() => emailAddresses('Display <me@example.test>'));
  assert.throws(() => emailAddresses(Array.from({ length: 21 }, (_, i) => i + '@example.test').join(',')));
  assert.throws(() =>
    validateAction({
      ...action,
      provider: 'gmail',
      target: 'me@example.test',
      title: 'Hi\nBcc: evil@example.test',
    }),
  );
  const d = validateAction({
    ...action,
    provider: 'gmail',
    target: 'x@example.test',
    title: 'Résumé',
    body: 'Price ₹500\nDo not change.',
  });
  const mime = mailMIME(d, 'me@example.test', 'abc');
  assert.match(mime, /Content-Transfer-Encoding: base64/);
  assert.equal(Buffer.from(mime.split('\r\n\r\n')[1], 'base64').toString(), 'Price ₹500\r\nDo not change.');
  for (const url of [
    'http://hooks.zapier.com/hooks/catch/1/abc/',
    'https://hooks.zapier.com.evil.test/hooks/catch/1/abc/',
    'https://127.0.0.1/',
    'https://hooks.zapier.com/hooks/catch/1/abc/?key=secret',
  ])
    assert.throws(() => zapierURL(url));
  assert.equal(
    zapierURL('https://hooks.zapier.com/hooks/catch/123/abc/'),
    'https://hooks.zapier.com/hooks/catch/123/abc/',
  );
});
test('provider adapters serialize the reviewed payload and use fixed origins without redirects', async () => {
  const cases = [
    ['gmail', 'x@example.test', '', { id: 'm1' }],
    ['outlook', 'x@example.test', '', null],
    ['notion', '12345678-1234-1234-1234-123456789012', '', { id: 'page1' }],
    ['hubspot', '123', 'contacts', { id: 'note1' }],
    ['attio', '12345678-1234-1234-1234-123456789012', 'people', { data: { id: { note_id: 'note1' } } }],
    ['affinity', '123', 'persons', { id: 23 }],
    ['zapier', '', '', null],
    ['google-event', 'x@example.test', '', { id: 'event1' }],
    ['outlook-event', 'x@example.test', '', { id: 'event1' }],
  ];
  for (const [provider, target, kind, receipt] of cases) {
    const { s, calls } = await setup((u, i) => {
      if (i.method === 'POST') return receipt ? json(receipt) : new Response(null, { status: 202 });
      if (provider === 'notion')
        return json({
          id: target,
          properties: { title: { type: 'title', title: [{ plain_text: 'Client notes' }] } },
        });
      if (provider === 'attio')
        return json({ data: { id: { record_id: target }, values: { name: [{ full_name: 'Priya' }] } } });
      return json({ id: target, properties: { firstname: 'Priya' }, first_name: 'Priya' });
    });
    if (!['gmail', 'outlook', 'google-event', 'outlook-event'].includes(provider))
      await s.configure({
        provider,
        secret: provider === 'zapier' ? 'https://hooks.zapier.com/hooks/catch/1/test/' : 'private-token',
        label: 'Test account',
      });
    const d = await s.prepare({
        ...action,
        provider,
        target,
        kind,
        start: new Date(Date.now() + 3600000).toISOString(),
        end: new Date(Date.now() + 7200000).toISOString(),
      }),
      r = await s.commit({ id: d.id, reviewed: true });
    assert.ok(['sent', 'accepted'].includes(r.state), provider + ': ' + r.error);
    const sent = calls.find((x) => x.method === 'POST');
    assert.equal(sent.redirect, 'error');
    assert.ok(!sent.url.includes('private-token'));
    if (provider === 'notion') assert.equal(sent.headers['Notion-Version'], '2026-03-11');
    if (provider === 'hubspot')
      assert.equal(JSON.parse(sent.body).associations[0].types[0].associationTypeId, 202);
    if (provider === 'zapier') assert.equal(sent.headers.Authorization, undefined);
  }
});
test('calendar capabilities require separately granted scopes and disconnect does not leave mail access', async () => {
  const v = vault(),
    c = createCalendars({ vault: v, openExternal: async () => {} });
  await v.write('calendars', {
    google: {
      clientId: 'client',
      access_token: 'secret',
      email: 'me@example.test',
      connectionId: 'a',
      expiresAt: Date.now() + 3600000,
      scope: optionalScopes.google.mailSend,
    },
  });
  assert.equal((await c.access('google', 'mailSend')).email, 'me@example.test');
  await assert.rejects(c.access('google', 'mailRead'), /required permission/);
  await c.disconnect('google');
  await assert.rejects(c.access('google', 'mailSend'), /required permission/);
});
test('email preview reads are bounded, return snippets only and reject query injection', async () => {
  const { s, calls } = await setup((u) =>
    String(u).includes('/messages?')
      ? json({ messages: [{ id: 'a' }] })
      : json({
          id: 'a',
          snippet: 'Agreed deadline: Friday',
          payload: { headers: [{ name: 'Subject', value: 'Planning' }] },
          raw: 'never exposed',
        }),
  );
  await assert.rejects(s.mailContext({ provider: 'google', addresses: 'x@example.test OR newer_than:10y' }));
  const r = await s.mailContext({ provider: 'google', addresses: 'x@example.test' });
  assert.equal(r.messages.length, 1);
  assert.equal(r.messages[0].text, 'Agreed deadline: Friday');
  assert.ok(!JSON.stringify(r).includes('never exposed'));
  assert.ok(calls.every((x) => x.method === 'GET'));
});
