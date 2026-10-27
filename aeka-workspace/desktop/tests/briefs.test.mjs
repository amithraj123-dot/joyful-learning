import test from 'node:test';
import assert from 'node:assert/strict';
import { createBriefs, briefDefaults } from '../services/briefs.mjs';
const now = () => new Date('2026-10-20T12:00:00Z').getTime();
const event = {
  id: 'google_a',
  title: 'Client review',
  start: '2026-10-20T14:00:00Z',
  end: '2026-10-20T15:00:00Z',
  url: '',
  attendees: ['p@example.test'],
};
const setup = () => {
  const m = new Map(),
    notes = [];
  let calls = 0,
    allow = true;
  const vault = {
    read: async (k, f) => structuredClone(m.has(k) ? m.get(k) : f),
    write: async (k, v) => m.set(k, structuredClone(v)),
  };
  const workspace = {
    status: async () => ({ openaiConfigured: true }),
    studioGet: async () => ({ config: { defaultTemplate: 'auto' } }),
    list: async () => structuredClone(notes),
    save: async (n, base) => {
      const old = notes.find((x) => x.id === n.id);
      if (old && old.updatedAt !== base) throw Error('Concurrent edit');
      const saved = { ...structuredClone(n), updatedAt: (old?.updatedAt || 0) + 1 };
      notes.splice(0, notes.length, ...notes.filter((x) => x.id !== n.id), saved);
      return structuredClone(saved);
    },
    ai: async () => {
      calls++;
      return { text: 'Prior decisions and suggested agenda.' };
    },
  };
  const b = createBriefs({ vault, workspace, now, permitted: () => allow });
  return { b, notes, vault, workspace, calls: () => calls, setAllowed: (v) => (allow = v) };
};
test('brief scheduler stays off by default, requires fresh calendar and respects policy', async () => {
  const x = setup();
  await x.b.tick({ events: [event], fresh: true });
  assert.equal(x.calls(), 0);
  await x.b.configure({ ...briefDefaults, enabled: true, hour: 0 });
  await x.b.tick({ events: [event], fresh: false });
  x.setAllowed(false);
  await x.b.tick({ events: [event], fresh: true });
  assert.equal(x.calls(), 0);
  x.setAllowed(true);
  await x.b.tick({ events: [event], fresh: true, busy: true });
  assert.equal(x.calls(), 0);
});
test('automatic briefs are durable, once per calendar instance and include calendar context', async () => {
  const x = setup();
  await x.b.configure({ ...briefDefaults, enabled: true, hour: 0 });
  await Promise.all([x.b.tick({ events: [event], fresh: true }), x.b.tick({ events: [event], fresh: true })]);
  await x.b.tick({ events: [event], fresh: true });
  assert.equal(x.calls(), 1);
  assert.equal(x.notes.length, 1);
  assert.equal(x.notes[0].details.eventStart, event.start);
  assert.deepEqual(x.notes[0].details.attendees, event.attendees);
  assert.match(x.notes[0].details.brief, /Prior decisions/);
  assert.equal((await x.b.status()).history[0].state, 'ready');
});
test('a concurrent note edit wins over generated text; failed work is not retried automatically', async () => {
  const x = setup();
  x.workspace.ai = async () => {
    x.notes[0].updatedAt++;
    x.notes[0].body = 'User edit';
    return { text: 'Generated brief' };
  };
  await x.b.configure({ ...briefDefaults, enabled: true, hour: 0 });
  await x.b.tick({ events: [event], fresh: true });
  assert.equal(x.notes[0].body, 'User edit');
  assert.equal(x.notes[0].details.brief, '');
  assert.equal((await x.b.status()).history[0].state, 'failed');
  const state = await x.b.status();
  await x.b.tick({ events: [event], fresh: true });
  assert.equal((await x.b.status()).history.length, 1);
  await x.b.retry(state.history[0].key);
  assert.equal((await x.b.status()).history.length, 0);
});
test('existing briefs and active recordings are not overwritten; startup interrupts in-flight work', async () => {
  const x = setup();
  x.notes.push({ id: 'existing', eventId: event.id, status: 'draft', details: { brief: 'My own brief' } });
  await x.b.configure({ ...briefDefaults, enabled: true, hour: 0 });
  await x.b.tick({ events: [event], fresh: true });
  assert.equal(x.calls(), 0);
  assert.equal(x.notes[0].details.brief, 'My own brief');
  await x.vault.write('brief-history', [{ key: 'k', state: 'generating' }]);
  await x.b.recover();
  assert.equal((await x.b.status()).history[0].state, 'interrupted');
});
