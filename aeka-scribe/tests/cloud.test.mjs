import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudRequest } from '../lib/cloud-api.ts';
import { workspaceRequest } from '../lib/workspace-api.ts';
import { database } from './helpers/database.mjs';
const note = {
  id: 'meeting-1',
  title: 'Meeting',
  kind: 'meeting',
  createdAt: 1,
  updatedAt: 1,
  body: 'Original decision',
  summary: '',
  folder: '',
  segments: [],
  speakers: {},
  eventId: '',
  status: 'complete',
  duration: 1,
};
const owner = { userId: 'owner', email: 'owner@example.com' },
  viewer = { userId: 'viewer', email: 'viewer@example.com' },
  stranger = { userId: 'stranger', email: 'stranger@example.com' };
const req = (action, p = {}, origin = 'https://flow.example') =>
  new Request('https://flow.example/api/cloud', {
    method: 'POST',
    headers: { Origin: origin },
    body: JSON.stringify({ action, ...p }),
  });
const call = (db, user, action, p) => cloudRequest(req(action, p), db, user);
const value = async (r) => (await r.json()).value;
test('cloud access requires trusted identity and same-origin requests', async () => {
  assert.equal((await call(undefined, null, 'status')).status, 401);
  assert.equal(
    (await cloudRequest(req('status', {}, 'https://other.example'), database(), owner)).status,
    403,
  );
});
test('sync revisions prevent resurrection, stale deletion and overwriting concurrent edits', async () => {
  const db = database(),
    n = await value(await call(db, owner, 'sync.save', { note, baseUpdatedAt: 0 }));
  const saved = await value(
    await call(db, owner, 'sync.save', { note: { ...n, body: 'New' }, baseUpdatedAt: n.updatedAt }),
  );
  assert.equal((await call(db, owner, 'sync.delete', { id: n.id, baseUpdatedAt: n.updatedAt })).status, 409);
  assert.equal((await call(db, owner, 'sync.save', { note: n, baseUpdatedAt: n.updatedAt })).status, 409);
  assert.equal(
    (await call(db, owner, 'sync.delete', { id: n.id, baseUpdatedAt: saved.updatedAt })).status,
    200,
  );
  assert.equal((await call(db, owner, 'sync.save', { note, baseUpdatedAt: 0 })).status, 410);
  assert.deepEqual(await value(await call(db, stranger, 'sync.index')), []);
});
test('viewers may read and comment but cannot edit, grant or delete another owner’s notes', async () => {
  const db = database(),
    n = await value(await call(db, owner, 'sync.save', { note }));
  await call(db, owner, 'shares.grant', { id: n.id, email: viewer.email, role: 'viewer' });
  const shared = await value(await call(db, viewer, 'shared.list'));
  assert.equal(shared[0].note.title, n.title);
  assert.equal(shared[0].note.body, undefined);
  assert.equal(
    (await value(await call(db, viewer, 'shared.get', { owner: owner.userId, id: n.id }))).body,
    n.body,
  );
  assert.deepEqual(await value(await call(db, stranger, 'shared.list')), []);
  assert.equal(
    (
      await call(db, viewer, 'shared.save', {
        owner: owner.userId,
        note: { ...n, body: 'Unauthorized' },
        baseUpdatedAt: n.updatedAt,
      })
    ).status,
    403,
  );
  assert.equal(
    (await call(db, viewer, 'shares.grant', { id: n.id, email: stranger.email, role: 'editor' })).status,
    404,
  );
  assert.equal(
    (
      await call(db, viewer, 'comments.add', {
        owner: owner.userId,
        id: n.id,
        commentId: 'comment-1',
        text: 'Please review',
      })
    ).status,
    200,
  );
  await call(db, viewer, 'comments.add', {
    owner: owner.userId,
    id: n.id,
    commentId: 'comment-1',
    text: 'duplicate',
  });
  assert.equal((await value(await call(db, owner, 'comments.list', { id: n.id }))).length, 1);
  assert.equal((await call(db, stranger, 'comments.list', { owner: owner.userId, id: n.id })).status, 403);
});
test('editor saves use CAS; revocation and disabled sharing take effect on the next request', async () => {
  const db = database(),
    n = await value(await call(db, owner, 'sync.save', { note }));
  await call(db, owner, 'shares.grant', { id: n.id, email: viewer.email, role: 'editor' });
  assert.equal(
    (
      await call(db, viewer, 'shared.save', {
        owner: owner.userId,
        note: { ...n, body: 'Edited' },
        baseUpdatedAt: n.updatedAt,
      })
    ).status,
    200,
  );
  assert.equal(
    (await call(db, viewer, 'shared.save', { owner: owner.userId, note: n, baseUpdatedAt: n.updatedAt }))
      .status,
    409,
  );
  await call(db, owner, 'policy.save', { policy: { sharing: false, cloudAI: false, retentionDays: 0 } });
  assert.deepEqual(await value(await call(db, viewer, 'shared.list')), []);
  assert.equal((await call(db, viewer, 'comments.list', { owner: owner.userId, id: n.id })).status, 403);
  await call(db, owner, 'shares.revoke', { id: n.id, email: viewer.email });
  assert.deepEqual(await value(await call(db, owner, 'shares.list')), []);
  const ai = await workspaceRequest(
    req('ai', { kind: 'summary', noteIds: [n.id], text: '', instruction: '' }),
    db,
    'sk-test',
    owner.userId,
    () => {
      throw Error('Must not call provider');
    },
  );
  assert.equal(ai.status, 403);
});
test('retention removes inactive notes and grants but preserves active recordings', async () => {
  const db = database();
  // A recording counts as active while it keeps saving; 'stale' stopped saving long ago.
  for (const [id, status, at] of [
    ['old', 'complete', 1],
    ['active', 'recording', Date.now()],
    ['stale', 'recording', 1],
  ]) {
    const n = { ...note, id, status, updatedAt: at };
    db.sql
      .prepare('INSERT INTO workspace_notes VALUES(?,?,?,?)')
      .run(owner.userId, id, JSON.stringify(n), at);
  }
  await call(db, owner, 'shares.grant', { id: 'old', email: viewer.email, role: 'viewer' });
  await call(db, owner, 'policy.save', { policy: { sharing: true, cloudAI: true, retentionDays: 7 } });
  const list = await value(await call(db, owner, 'sync.index'));
  assert.deepEqual(
    list.map((n) => n.id),
    ['active'],
  );
  assert.deepEqual(await value(await call(db, owner, 'shares.list')), []);
  assert.equal((await call(db, owner, 'sync.save', { note: { ...note, id: 'old' } })).status, 410);
});
test('team dictionaries use scoped access, strict validation and revision checks', async () => {
  const db = database(),
    resources = { terms: [{ id: 'term', phrase: 'aeka', replacement: 'Aeka' }], snippets: [] };
  const d = await value(await call(db, owner, 'resources.save', { value: resources, revision: 0 }));
  await call(db, owner, 'shares.grant', { kind: 'resources', email: viewer.email, role: 'viewer' });
  assert.deepEqual(
    (await value(await call(db, viewer, 'resources.get', { owner: owner.userId }))).value,
    resources,
  );
  assert.equal(
    (
      await call(db, viewer, 'resources.save', {
        owner: owner.userId,
        value: resources,
        revision: d.revision,
      })
    ).status,
    403,
  );
  assert.equal((await call(db, stranger, 'resources.get', { owner: owner.userId })).status, 403);
  assert.equal((await call(db, owner, 'resources.save', { value: resources, revision: 0 })).status, 409);
  assert.equal(
    (await call(db, owner, 'resources.save', { value: { terms: [{}], snippets: [] }, revision: d.revision }))
      .status,
    400,
  );
  const events = await value(await call(db, owner, 'audit.list'));
  assert.ok(events.some((e) => e.action === 'dictionary.updated'));
  assert.ok(events.every((e) => !JSON.stringify(e).includes('replacement')));
});
test('editors cannot change a shared note’s status, kind or creation time', async () => {
  const db = database(),
    n = await value(await call(db, owner, 'sync.save', { note }));
  await call(db, owner, 'shares.grant', { id: n.id, email: viewer.email, role: 'editor' });
  const saved = await value(
    await call(db, viewer, 'shared.save', {
      owner: owner.userId,
      note: { ...n, body: 'Edited', status: 'recording', kind: 'scratchpad', createdAt: 99 },
      baseUpdatedAt: n.updatedAt,
    }),
  );
  assert.equal(saved.body, 'Edited');
  assert.equal(saved.status, 'complete');
  assert.equal(saved.kind, 'meeting');
  assert.equal(saved.createdAt, 1);
});
test('internal errors are not echoed to the client', async () => {
  const r = await cloudRequest(
    new Request('https://flow.example/api/cloud', {
      method: 'POST',
      headers: { Origin: 'https://flow.example' },
      body: 'null',
    }),
    database(),
    owner,
  );
  const body = await r.json();
  assert.doesNotMatch(JSON.stringify(body), /Cannot read properties/);
});
