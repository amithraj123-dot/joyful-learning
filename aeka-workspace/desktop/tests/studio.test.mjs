import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace } from '../services/workspace.mjs';
import { emptyDetails } from '../generated/note-details.mjs';
import { defaultStudio } from '../generated/meeting-studio.mjs';
const vault = () => {
  const values = new Map();
  return {
    read: async (k, f = null) => structuredClone(values.has(k) ? values.get(k) : f),
    write: async (k, v) => values.set(k, structuredClone(v)),
    remove: async (k) => values.delete(k),
  };
};
const note = () => ({
  id: 'one',
  title: 'Planning',
  kind: 'meeting',
  createdAt: 1,
  updatedAt: 1,
  folder: 'Work',
  body: 'Do not increase the budget.',
  summary: '',
  segments: [],
  speakers: {},
  eventId: '',
  status: 'draft',
  duration: 0,
});
test('desktop playbooks survive backup and restore without exposing credentials; stale changes fail', async () => {
  const v = vault(),
    w = createWorkspace({ vault: v, emit: () => {} });
  await v.write('credentials', { openaiKey: 'secret' });
  const saved = await w.studioSave({ ...defaultStudio(), context: 'Our role' }, 0);
  await assert.rejects(w.studioSave(defaultStudio(), 0), /another window/);
  assert.equal((await w.studioGet()).revision, saved.revision);
  const backup = await w.backup();
  assert.ok(!JSON.stringify(backup).includes('secret'));
  const next = createWorkspace({ vault: vault(), emit: () => {} });
  await next.restore(backup);
  assert.equal((await next.studioGet()).config.context, 'Our role');
});
test('desktop trash rejects active and pending audio, restores metadata and expires after thirty days', async () => {
  const v = vault(),
    w = createWorkspace({ vault: v, emit: () => {} });
  const n = await w.save({ ...note(), status: 'recording' });
  await assert.rejects(
    w.save({ ...n, details: { ...emptyDetails(), trashedAt: Date.now() } }, n.updatedAt),
    /Finish recording/,
  );
  const complete = await w.save({ ...n, status: 'complete' }, n.updatedAt);
  await v.write('queue', [{ id: 'q', noteId: n.id, done: false }]);
  await assert.rejects(
    w.save({ ...complete, details: { ...emptyDetails(), trashedAt: Date.now() } }, complete.updatedAt),
    /pending transcription/,
  );
  await v.write('queue', []);
  const trashed = await w.save(
    {
      ...complete,
      details: { ...emptyDetails(), attendees: ['p@acme.test'], trashedAt: Date.now() - 31 * 86400000 },
    },
    complete.updatedAt,
  );
  assert.ok(trashed.details.attendees.includes('p@acme.test'));
  await w.maintenance();
  assert.equal((await w.list()).length, 0);
  assert.ok((await v.read('deleted')).one);
});
test('new AI workflows honour native cloud policy before invoking a provider', async () => {
  let calls = 0;
  const w = createWorkspace({
    vault: vault(),
    emit: () => {},
    policy: () => ({ allowCloudAI: false }),
    fetcher: async () => {
      calls++;
      throw Error();
    },
  });
  await w.save(note());
  await assert.rejects(w.ai({ kind: 'brief', noteIds: ['one'] }), /disabled/);
  assert.equal(calls, 0);
});
