import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mailServer } from '../modules/mail/server/index.ts';
import { finishConnect, startConnect } from '../modules/mail/server/oauth.ts';
import { trimBody } from '../modules/mail/server/sync.ts';
import { people } from './fixtures/workflow-firm.mjs';
import { mailFirm, origin } from './fixtures/mail-world.mjs';

test('the server implements exactly the actions of the shared contract', () => {
  const contract = readFileSync(new URL('../modules/mail/shared/contract.ts', import.meta.url), 'utf8');
  const start = contract.indexOf('export interface MailActions');
  const block = contract.slice(start, contract.indexOf('\n}\n', start));
  const names = [...block.matchAll(/^ {2}'?([\w.]+)'?: \{/gm)].map((m) => m[1]).sort();
  assert.ok(names.length >= 20);
  assert.deepEqual(Object.keys(mailServer.actions).sort(), names);
  assert.equal(typeof mailServer.tick, 'function');
});

test('connect refuses without sign-in, membership, Outlook settings or the encryption key', async () => {
  const f = await mailFirm();
  const code = async (user, env = f.options.env) => {
    const r = await startConnect(new Request(origin + '/api/mail/connect'), f.deps(user, { env }));
    assert.equal(r.status, 302);
    return new URL(r.headers.get('Location')).searchParams.get('mail_error');
  };
  assert.equal(await code(null), 'signin');
  assert.equal(await code(people.outsider), 'not_member');
  assert.equal(await code(people.admin, { ...f.options.env, AEKA_ENCRYPTION_KEY: '' }), 'storage');
  assert.equal(await code(people.admin, { ...f.options.env, MS_CLIENT_SECRET: '' }), 'not_configured');
  assert.equal(f.rows('SELECT * FROM mail_oauth_states').length, 0);

  const r = await startConnect(new Request(origin + '/api/mail/connect'), f.deps(people.admin));
  const to = new URL(r.headers.get('Location'));
  assert.equal(
    to.origin + to.pathname,
    'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize',
  );
  assert.equal(to.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(to.searchParams.get('response_mode'), 'query');
  assert.equal(to.searchParams.get('prompt'), 'select_account');
  assert.equal(to.searchParams.get('redirect_uri'), origin + '/api/mail/callback');
  assert.match(to.searchParams.get('scope'), /offline_access .*Mail\.ReadWrite Mail\.Send/);
  const [row] = f.rows('SELECT * FROM mail_oauth_states');
  assert.equal(row.member, people.admin.email);
  assert.match(row.verifier_sealed, /^v1\./); // the PKCE verifier is sealed
});

test('callback state must exist, be fresh, belong to the same member and be used once', async () => {
  const f = await mailFirm();
  const begin = async () => {
    const r = await startConnect(new Request(origin + '/api/mail/connect'), f.deps(people.admin));
    return new URL(r.headers.get('Location')).searchParams.get('state');
  };
  const callback = (user, state, over = {}) =>
    finishConnect(
      new Request(`${origin}/api/mail/callback?code=code-${people.admin.email}&state=${state}`),
      f.deps(user, over),
    ).then((r) => new URL(r.headers.get('Location')).search);

  const state = await begin();
  assert.match(await callback(people.partner, state), /mail_error=mismatch/); // another member's state
  assert.match(await callback(people.admin, 'x'.repeat(40)), /mail_error=state/); // unknown
  assert.match(await callback(people.admin, state, { now: Date.now() + 11 * 60000 }), /mail_error=expired/);
  assert.match(await callback(people.admin, state), /mail_error=state/); // used once already

  const fresh = await begin();
  assert.match(await callback(people.admin, fresh), /mail=connected/);
  assert.match(await callback(people.admin, fresh), /mail_error=state/); // reused
  const [account] = f.rows('SELECT * FROM mail_accounts');
  assert.equal(account.member, people.admin.email);
  assert.equal(account.status, 'connected');
  assert.ok(!account.token_sealed.includes('at-') && !account.token_sealed.includes('rt-'));
  const exchange = f.w.calls.find((c) => c.url.includes('/oauth2/v2.0/token'));
  assert.ok(new URLSearchParams(exchange.body).get('code_verifier'));
  const activity = f.rows("SELECT summary FROM org_activity WHERE module = 'mail'");
  assert.deepEqual(
    activity.map((a) => a.summary),
    ['Connected Outlook'],
  );
  const got = await f.ok('admin', 'account.get');
  assert.equal(got.account.address, people.admin.email);
  assert.deepEqual(got.account.settings, { aiTriage: true, alertUrgent: true });
  assert.equal(got.setup.storageReady, true);
  assert.equal((await f.ok('partner', 'account.get')).account, null);
});

test('sync is idempotent, keeps the checkpoint, and records deletions without failures', async () => {
  const f = await mailFirm();
  await f.connect();
  const first = await f.ok('admin', 'sync');
  assert.equal(first.fetched, 11); // 10 inbox (over three pages) and 1 sent
  const count = () => f.rows('SELECT count(*) AS n FROM mail_messages')[0].n;
  const triageRows = () => f.rows('SELECT count(*) AS n FROM mail_triage')[0].n;
  assert.equal(count(), 11);
  assert.equal(triageRows(), 10); // sent items are never triaged
  const [acct] = f.rows('SELECT inbox_delta, sent_delta FROM mail_accounts');
  assert.match(acct.inbox_delta, /\$deltatoken=/);
  assert.match(acct.sent_delta, /\$deltatoken=/);
  // The first request asked only for the last 14 days, as plain text with immutable ids.
  const firstDelta = f.w.graphCalls().find((c) => c.url.includes('/messages/delta'));
  assert.match(decodeURIComponent(firstDelta.url), /receivedDateTime ge 20\d\d-/);

  // The same delta again: nothing duplicated, nothing re-triaged.
  f.w.box(people.admin.email).replay = true;
  const aiBefore = f.w.ai.length;
  const again = await f.ok('admin', 'sync');
  assert.equal(count(), 11);
  assert.equal(triageRows(), 10);
  assert.equal(f.w.ai.length, aiBefore);
  assert.equal(again.failed, 0);

  // A deletion entry marks the message removed and never creates a failure.
  f.w.box(people.admin.email).replay = false;
  f.w
    .box(people.admin.email)
    .changes.push(
      { id: 'g-kestrel', '@removed': { reason: 'deleted' } },
      { id: 'g-unknown', '@removed': { reason: 'deleted' } },
    );
  const third = await f.ok('admin', 'sync');
  assert.equal(third.failed, 0);
  assert.equal(count(), 11);
  assert.ok(f.rows("SELECT removed_at FROM mail_messages WHERE graph_id = 'g-kestrel'")[0].removed_at);
  const list = await f.ok('admin', 'inbox.list', { view: 'all' });
  assert.ok(!list.items.some((i) => i.subject.startsWith('Project Kestrel')));
  assert.equal(list.counts.failed, 0);
});

test('headers refused by delta are read per message before triage', async () => {
  const f = await mailFirm();
  f.w.refuseHeaders = true;
  await f.connect();
  await f.ok('admin', 'sync');
  const reads = f.w
    .graphCalls()
    .filter((c) => c.url.includes('internetMessageHeaders') && !c.url.includes('/delta'));
  assert.ok(reads.length >= 1 && reads.length <= 10);
  const digest = await f.item('g-digest');
  assert.equal(digest.triage.source, 'rules');
  assert.equal(digest.triage.tier, 4);
  assert.ok(!f.w.aiText().includes('Weekly tax digest'));
});

test('quoted history and signatures are trimmed; forwards keep their content', () => {
  assert.equal(
    trimBody('Thanks, noted.\n\nOn Mon, 20 Oct 2026, A wrote:\n> old text', 'RE: x'),
    'Thanks, noted.',
  );
  assert.equal(
    trimBody('Please see below.\n\nFrom: A\nSent: Monday\nTo: B\nSubject: x\n\nOld', 'RE: x'),
    'Please see below.',
  );
  assert.match(trimBody('FYI\n\nFrom: A\nSent: Monday\n\nThe forwarded text', 'FW: x'), /forwarded text/);
  assert.equal(trimBody('Agreed.\n--\nAmith Rao\nPartner', ''), 'Agreed.');
  assert.equal(trimBody('x'.repeat(30000), '').length, 20000);
});
