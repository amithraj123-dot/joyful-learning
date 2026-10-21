import test from 'node:test';
import assert from 'node:assert/strict';
import { database } from './helpers/database.mjs';
import { workspaceRequest } from '../lib/workspace-api.ts';
import { cloudRequest } from '../lib/cloud-api.ts';
const note = {
  id: 'same-id',
  title: 'Private note',
  kind: 'scratchpad',
  createdAt: 1,
  updatedAt: 1,
  folder: '',
  body: 'Private account one',
  summary: '',
  segments: [],
  speakers: {},
  eventId: '',
  status: 'draft',
  duration: 0,
};
const request = (body, origin = 'https://flow.example') =>
  new Request('https://flow.example/api/workspace', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
const call = (db, user, action, data = {}) =>
  workspaceRequest(request({ action, ...data }), db, undefined, user);
const json = async (r) => (await r.json()).value;
const insert = (db, owner, n) =>
  db.sql
    .prepare('INSERT INTO workspace_notes VALUES(?,?,?,?)')
    .run(owner, n.id, JSON.stringify(n), n.updatedAt);
const stored = (db) =>
  db.sql
    .prepare('SELECT id FROM workspace_notes ORDER BY id')
    .all()
    .map((r) => r.id);
test('workspace refuses unauthenticated and cross-origin requests before touching storage', async () => {
  assert.equal(
    (await workspaceRequest(request({ action: 'notes.list' }), undefined, undefined, null)).status,
    401,
  );
  assert.equal(
    (
      await workspaceRequest(
        request({ action: 'notes.list' }, 'https://evil.example'),
        undefined,
        undefined,
        'one',
      )
    ).status,
    403,
  );
});
test('notes are isolated by signed-in owner even when note IDs match', async () => {
  const db = database();
  assert.equal((await call(db, 'one', 'notes.save', { note })).status, 200);
  assert.equal((await call(db, 'two', 'notes.save', { note: { ...note, body: 'Account two' } })).status, 200);
  const one = await (await call(db, 'one', 'notes.list')).json(),
    two = await (await call(db, 'two', 'notes.list')).json();
  assert.equal(one.value.length, 1);
  assert.equal(one.value[0].body, 'Private account one');
  assert.equal(two.value[0].body, 'Account two');
  await call(db, 'one', 'notes.delete', { id: note.id });
  assert.equal((await (await call(db, 'two', 'notes.list')).json()).value.length, 1);
});
test('hosted notes reject stale revisions and preserve the newer contents', async () => {
  const db = database(),
    first = (await (await call(db, 'one', 'notes.save', { note })).json()).value;
  const updated = await call(db, 'one', 'notes.save', {
    note: { ...first, body: 'New text' },
    baseUpdatedAt: first.updatedAt,
  });
  assert.equal(updated.status, 200);
  const stale = await call(db, 'one', 'notes.save', {
    note: { ...first, body: 'Stale text' },
    baseUpdatedAt: first.updatedAt,
  });
  assert.equal(stale.status, 409);
  assert.equal((await (await call(db, 'one', 'notes.list')).json()).value[0].body, 'New text');
});
test('Ask never supplies a different owner’s notes to the model', async () => {
  const db = database();
  await call(db, 'one', 'notes.save', { note });
  await call(db, 'two', 'notes.save', { note: { ...note, id: 'other', body: 'Never disclose this' } });
  let input;
  const response = await workspaceRequest(
    request({
      action: 'ai',
      kind: 'ask',
      noteIds: ['same-id', 'other'],
      text: 'What was said?',
      instruction: '',
    }),
    db,
    'sk-test',
    'one',
    async (_url, init) => {
      input = JSON.parse(init.body).input;
      return Response.json({
        output: [{ content: [{ type: 'output_text', text: 'Answer [note:same-id]' }] }],
      });
    },
  );
  assert.equal(response.status, 200);
  assert.ok(input.includes('Private account one'));
  assert.ok(!input.includes('Never disclose this'));
  assert.equal((await response.json()).value.text, 'Answer [note:same-id]');
});
test('malformed notes and unsupported operations are rejected without mutation', async () => {
  const db = database();
  assert.equal((await call(db, 'one', 'notes.save', { note: { ...note, id: '../bad' } })).status, 400);
  assert.equal((await call(db, 'one', 'execute', { url: 'https://evil.example' })).status, 400);
  assert.equal((await (await call(db, 'one', 'notes.list')).json()).value.length, 0);
});
test('AI without a credential stays disabled and notes responses are private/no-store', async () => {
  const db = database();
  await call(db, 'one', 'notes.save', { note });
  const r = await call(db, 'one', 'notes.list');
  assert.equal(r.headers.get('Cache-Control'), 'private, no-store');
  const ai = await call(db, 'one', 'ai', { kind: 'summary', noteIds: [note.id], text: '', instruction: '' });
  assert.equal(ai.status, 400);
  assert.match((await ai.json()).error, /Connect OpenAI/);
});
test('notes.get and notes.index return one owner note or revisions only', async () => {
  const db = database(),
    saved = await json(await call(db, 'one', 'notes.save', { note }));
  await call(db, 'two', 'notes.save', { note: { ...note, id: 'theirs' } });
  assert.deepEqual(await json(await call(db, 'one', 'notes.index')), [
    { id: saved.id, updatedAt: saved.updatedAt },
  ]);
  assert.equal((await json(await call(db, 'one', 'notes.get', { id: saved.id }))).body, note.body);
  assert.equal(await json(await call(db, 'one', 'notes.get', { id: 'theirs' })), null);
  assert.equal((await call(db, 'one', 'notes.get', { id: '../x' })).status, 400);
});
test('retention sweeps at most every five minutes while reads hide expired notes at once', async () => {
  const db = database();
  await call(db, 'one', 'notes.list');
  db.sql.prepare('INSERT INTO workspace_policy VALUES(?,?)').run('one', JSON.stringify({ retentionDays: 7 }));
  insert(db, 'one', { ...note, id: 'old', updatedAt: 1 });
  insert(db, 'one', { ...note, id: 'older', updatedAt: 1 });
  assert.deepEqual(await json(await call(db, 'one', 'notes.list')), []);
  assert.deepEqual(await json(await call(db, 'one', 'notes.index')), []);
  // The sweep ran on the first request, so nothing is purged yet.
  assert.deepEqual(stored(db), ['old', 'older']);
  // Reading an expired note purges it.
  assert.equal(await json(await call(db, 'one', 'notes.get', { id: 'old' })), null);
  assert.deepEqual(stored(db), ['older']);
  db.sql.prepare('UPDATE workspace_maintenance SET retention_at = ?').run(Date.now() - 6 * 60000);
  await call(db, 'one', 'notes.list');
  assert.deepEqual(stored(db), []);
});
test('a recording idle for six hours is served as interrupted, can be trashed and expires', async () => {
  const db = database(),
    stale = Date.now() - 7 * 3600000;
  insert(db, 'one', { ...note, id: 'crashed', status: 'recording', updatedAt: stale });
  const live = await json(await call(db, 'one', 'notes.save', { note: { ...note, status: 'recording' } }));
  const listed = await json(await call(db, 'one', 'notes.list'));
  assert.equal(listed.find((n) => n.id === 'crashed').status, 'interrupted');
  assert.equal(listed.find((n) => n.id === live.id).status, 'recording');
  const trash = (n) => ({ ...n, status: 'recording', details: { trashedAt: Date.now() } });
  assert.equal(
    (await call(db, 'one', 'notes.save', { note: trash(live), baseUpdatedAt: live.updatedAt })).status,
    400,
  );
  const trashed = await call(db, 'one', 'notes.save', {
    note: trash(listed.find((n) => n.id === 'crashed')),
    baseUpdatedAt: stale,
  });
  assert.equal(trashed.status, 200);
  assert.equal((await json(trashed)).status, 'interrupted');
  // Retention no longer exempts it once it is idle.
  insert(db, 'one', { ...note, id: 'old-recording', status: 'recording', updatedAt: 1 });
  db.sql.prepare('INSERT INTO workspace_policy VALUES(?,?)').run('one', JSON.stringify({ retentionDays: 7 }));
  assert.equal(await json(await call(db, 'one', 'notes.get', { id: 'old-recording' })), null);
});
test('audit entries name the signed-in email whichever API made the change', async () => {
  const db = database(),
    user = { userId: 'one', email: 'One@Example.com' };
  await workspaceRequest(request({ action: 'notes.save', note }), db, undefined, 'one', fetch, user.email);
  await cloudRequest(
    new Request('https://flow.example/api/cloud', {
      method: 'POST',
      headers: { Origin: 'https://flow.example' },
      body: JSON.stringify({ action: 'sync.save', note: { ...note, id: 'synced' } }),
    }),
    db,
    user,
  );
  const actors = db.sql.prepare('SELECT DISTINCT actor FROM workspace_audit').all();
  assert.deepEqual(
    actors.map((a) => a.actor),
    ['one@example.com'],
  );
});
