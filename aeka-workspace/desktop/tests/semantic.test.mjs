import test from 'node:test';
import assert from 'node:assert/strict';
import { createSemantic, semanticText } from '../services/semantic.mjs';
const note = (id, body) => ({
  id,
  title: 'Meeting ' + id,
  body,
  segments: [],
  updatedAt: 1,
  status: 'complete',
});
const setup = () => {
  const m = new Map(),
    notes = [note('one', 'We will defer the release.'), note('two', 'Lunch plan')];
  let calls = 0,
    allowed = true;
  const vault = {
      read: async (k, f) => structuredClone(m.has(k) ? m.get(k) : f),
      write: async (k, v) => m.set(k, structuredClone(v)),
    },
    fetcher = async (url, init) => {
      calls++;
      const p = JSON.parse(init.body);
      assert.equal(p.model, 'text-embedding-3-small');
      assert.equal(p.dimensions, 256);
      return Response.json({
        data: p.input.map((x, index) => ({
          index,
          embedding: Array.from({ length: 256 }, (_, i) =>
            i === (/defer|postpone/.test(x) ? 0 : 1) ? 1 : 0,
          ),
        })),
      });
    },
    s = createSemantic({
      vault,
      getNotes: async () => structuredClone(notes),
      getKey: async () => 'sk-test',
      permitted: () => allowed,
      fetcher,
    });
  return {
    s,
    notes,
    vault,
    calls: () => calls,
    block: () => {
      allowed = false;
    },
  };
};
test('semantic search is opt-in, uses validated embeddings and restricts matches to the selected scope', async () => {
  const x = setup();
  assert.equal(await x.s.rank(x.notes, 'postpone'), null);
  assert.equal(x.calls(), 0);
  await x.s.build();
  await x.s.configure(true);
  assert.equal((await x.s.status()).indexed, 2);
  const r = await x.s.rank(x.notes, 'postpone');
  assert.equal(r.ids[0], 'one');
  const scoped = await x.s.rank([x.notes[1]], 'postpone');
  assert.deepEqual(scoped.ids, ['two']);
});
test('changed, deleted and trashed notes cannot use stale vectors; pruning removes their stored vectors', async () => {
  const x = setup();
  await x.s.build();
  await x.s.configure(true);
  x.notes[0].body = 'Different content';
  x.notes[1].details = { trashedAt: 1 };
  assert.equal((await x.s.status()).indexed, 0);
  await assert.rejects(x.s.rank(x.notes, 'postpone'), /Refresh/);
  await x.s.prune();
  assert.equal((await x.vault.read('semantic-index')).records.length, 0);
  await x.s.build();
  assert.equal((await x.s.status()).indexed, 1);
  await x.s.clear();
  assert.equal((await x.s.status()).enabled, false);
});
test('semantic indexing obeys cloud policy and bounds each document excerpt', async () => {
  const x = setup();
  x.block();
  await assert.rejects(x.s.build(), /policy/);
  assert.equal(x.calls(), 0);
  assert.equal(semanticText(note('long', 'x'.repeat(20000))).length, 6000);
});
