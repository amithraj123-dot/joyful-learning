import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultStudio,
  validStudio,
  prepareStudioTask,
  peopleDirectory,
  relatedNotes,
  actionsCalendar,
  parseActions,
  scopeNotes,
} from '../lib/meeting-studio.ts';
import { emptyDetails, validDetails } from '../lib/note-details.ts';
import { validNote } from '../lib/workspace-core.ts';
import { workspaceRequest } from '../lib/workspace-api.ts';
import { cloudRequest } from '../lib/cloud-api.ts';
import { notesMCP } from '../lib/notes-mcp.ts';
import { database } from './helpers/database.mjs';
const note = (id, patch = {}) => ({
  id,
  title: 'Project review',
  kind: 'meeting',
  createdAt: Date.now() - 1000,
  updatedAt: 1,
  folder: '',
  body: 'Approved budget is 500. Do not increase it.',
  summary: '',
  segments: [{ id: 's1', start: 1, end: 5, speaker: 'A', text: 'Priya will send the plan by 2026-10-30.' }],
  speakers: { A: 'Priya' },
  eventId: '',
  status: 'complete',
  duration: 5,
  ...patch,
});
const request = (body) =>
  new Request('https://flow.example/api/workspace', {
    method: 'POST',
    headers: { Origin: 'https://flow.example' },
    body: JSON.stringify(body),
  });
const call = async (db, owner, action, data = {}) => {
  const r = await workspaceRequest(request({ action, ...data }), db, undefined, owner);
  return { status: r.status, ...(await r.json()) };
};
const cloud = async (db, user, action, data = {}) => {
  const r = await cloudRequest(request({ action, ...data }), db, user);
  return { status: r.status, ...(await r.json()) };
};
const owner = { userId: 'owner', email: 'owner@example.test' },
  guest = { userId: 'guest', email: 'guest@example.test' };
test('all meeting metadata survives validation while malformed attachments and duplicate actions fail', () => {
  const n = note('one', {
    details: {
      ...emptyDetails(),
      attendees: ['p@acme.test'],
      folders: ['Clients/Acme'],
      tags: ['review'],
      brief: 'Context',
      followUp: 'Draft',
      starred: true,
      actions: [
        { id: 'a', text: 'Send plan', owner: 'Priya', due: '2026-10-30', done: false, segmentId: 's1' },
      ],
      context: [{ id: 'c', name: 'agenda.md', text: 'Discuss budget', at: 1 }],
      versions: [{ id: 'v', at: 2, summary: 'Previous' }],
    },
  });
  assert.deepEqual(validNote(n), n);
  assert.throws(() =>
    validDetails({ ...n.details, context: [{ id: 'x', name: 'x', text: 'a'.repeat(30001), at: 1 }] }),
  );
  assert.throws(() => validDetails({ ...n.details, actions: [n.details.actions[0], n.details.actions[0]] }));
});
test('templates guide summaries without replacing original evidence; actions reject malformed provider output', () => {
  const config = {
    ...defaultStudio(),
    templates: [
      {
        id: 'custom',
        name: 'Review',
        instructions: 'Use concise bullets.',
        sections: ['Context', 'Commitments'],
      },
    ],
  };
  const n = note('one', { details: { ...emptyDetails(), templateId: 'custom' } });
  const task = prepareStudioTask([n], validStudio(config), {
    kind: 'summary',
    noteIds: ['one'],
    text: '',
    instruction: '',
  });
  assert.match(task.instructions, /Context; Commitments/);
  assert.match(task.input, /Do not increase it/);
  assert.equal(n.summary, '');
  assert.throws(() =>
    validStudio({ ...config, templates: [...config.templates, { ...config.templates[0], id: 'auto' }] }),
  );
  assert.deepEqual(parseActions('```json\n[{"text":"Send plan","owner":"Priya","due":""}]\n```'), [
    { text: 'Send plan', owner: 'Priya', due: '' },
  ]);
  assert.throws(() => parseActions('[{"text":"oops"}]'));
});
test('directory, folder search and briefs use saved attendees and exclude trash and future meetings', () => {
  const older = note('old', {
      folder: 'Clients/Acme',
      createdAt: 100,
      details: { ...emptyDetails(), attendees: ['Priya@Acme.test'] },
    }),
    upcoming = note('new', {
      createdAt: 500,
      details: { ...emptyDetails(), attendees: ['priya@acme.test'] },
    }),
    deleted = note('deleted', {
      createdAt: 50,
      details: { ...emptyDetails(), trashedAt: 1, attendees: ['secret@acme.test'] },
    }),
    future = note('future', { createdAt: 700 });
  assert.deepEqual(
    relatedNotes(upcoming, [older, upcoming, deleted, future]).map((n) => n.id),
    ['old'],
  );
  assert.equal(peopleDirectory([older, upcoming, deleted]).length, 1);
  assert.deepEqual(
    scopeNotes([older, upcoming, deleted], [], { folder: 'Clients' }).map((n) => n.id),
    ['old'],
  );
  assert.deepEqual(
    scopeNotes([older, deleted], [], { person: 'priya@acme.test' }).map((n) => n.id),
    ['old'],
  );
});
test('cross-meeting retrieval finds an older relevant note and reports bounded evidence coverage', () => {
  const all = Array.from({ length: 65 }, (_, i) =>
    note('n' + i, {
      title: i === 0 ? 'Zirconia milestone' : 'Standup',
      createdAt: i + 1000,
      body: i === 0 ? 'Zirconia launch moved to December.' : 'Routine update',
      segments: [],
    }),
  );
  const r = prepareStudioTask(all, defaultStudio(), {
    kind: 'ask',
    noteIds: [],
    text: 'What changed for Zirconia?',
    instruction: '',
  });
  assert.equal(r.sources[0].id, 'n0');
  assert.equal(r.coverage.matched, 65);
  assert.equal(r.coverage.used, 24);
  assert.equal(r.coverage.excerpted, true);
  assert.throws(
    () =>
      prepareStudioTask(all, defaultStudio(), {
        kind: 'recipe',
        recipeId: 'catch-up',
        noteIds: [],
        text: '',
        instruction: '',
      }),
    /exactly one/,
  );
});
test('studio config is owner-isolated, persistent and protected against stale writes', async () => {
  const db = database();
  const value = { ...defaultStudio(), context: 'Tax advisory' };
  const first = await call(db, 'a', 'studio.save', { config: value, revision: 0 });
  assert.equal(first.status, 200);
  assert.equal((await call(db, 'b', 'studio.get')).value.config.context, '');
  assert.equal((await call(db, 'a', 'studio.get')).value.config.context, 'Tax advisory');
  assert.equal((await call(db, 'a', 'studio.save', { config: defaultStudio(), revision: 0 })).status, 409);
});
test('trash remains restorable but cannot enter AI, MCP or shared note access; expiry purges it', async () => {
  const db = database();
  const first = (await call(db, 'owner', 'notes.save', { note: note('private') })).value;
  await cloud(db, owner, 'shares.grant', { id: first.id, email: guest.email, role: 'viewer' });
  const trashed = (
    await call(db, 'owner', 'notes.save', {
      note: { ...first, details: { ...emptyDetails(), trashedAt: Date.now() } },
      baseUpdatedAt: first.updatedAt,
    })
  ).value;
  assert.equal((await call(db, 'owner', 'notes.list')).value.length, 1);
  assert.equal((await cloud(db, guest, 'shared.list')).value.length, 0);
  assert.equal((await cloud(db, guest, 'shared.get', { owner: 'owner', id: first.id })).status, 404);
  let providerCalled = false;
  const ai = await workspaceRequest(
    request({ action: 'ai', kind: 'ask', noteIds: [first.id], text: 'budget', instruction: '' }),
    db,
    'sk-test',
    'owner',
    async () => {
      providerCalled = true;
      throw Error();
    },
  );
  assert.equal(ai.status, 400);
  assert.equal(providerCalled, false);
  const mcp = await notesMCP(
    request({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_note', arguments: { id: first.id } },
    }),
    db,
    'owner',
  );
  assert.equal((await mcp.json()).result.isError, true);
  const restored = (
    await call(db, 'owner', 'notes.save', {
      note: { ...trashed, details: { ...trashed.details, trashedAt: 0 } },
      baseUpdatedAt: trashed.updatedAt,
    })
  ).value;
  assert.equal((await cloud(db, guest, 'shared.list')).value.length, 1);
  await call(db, 'owner', 'notes.save', {
    note: { ...restored, details: { ...restored.details, trashedAt: Date.now() - 31 * 86400000 } },
    baseUpdatedAt: restored.updatedAt,
  });
  // Hidden at once; purged when the throttled retention sweep next runs.
  assert.equal((await call(db, 'owner', 'notes.list')).value.length, 0);
  db.sql.exec('DELETE FROM workspace_maintenance');
  await call(db, 'owner', 'notes.index');
  assert.equal(db.sql.prepare('SELECT count(*) AS n FROM workspace_notes').get().n, 0);
});
test('folder grants cover new and nested notes, reject privilege changes and stop at folder boundaries', async () => {
  const db = database();
  const first = (await call(db, 'owner', 'notes.save', { note: note('one', { folder: 'Clients/Acme' }) }))
    .value;
  await call(db, 'owner', 'notes.save', { note: note('not-acme', { folder: 'Clients/AcmeOther' }) });
  assert.equal(
    (
      await cloud(db, owner, 'shares.grant', {
        kind: 'folder',
        id: 'Clients/Acme',
        email: guest.email,
        role: 'editor',
      })
    ).status,
    200,
  );
  await call(db, 'owner', 'notes.save', {
    note: note('two', { folder: 'Other', details: { ...emptyDetails(), folders: ['Clients/Acme/Q4'] } }),
  });
  assert.deepEqual((await cloud(db, guest, 'shared.list')).value.map((x) => x.target).sort(), ['one', 'two']);
  assert.equal((await cloud(db, guest, 'shared.get', { owner: 'owner', id: 'not-acme' })).status, 403);
  assert.equal(
    (
      await cloud(db, guest, 'shared.save', {
        owner: 'owner',
        note: { ...first, folder: 'Elsewhere' },
        baseUpdatedAt: first.updatedAt,
      })
    ).status,
    403,
  );
  const moved = (
    await call(db, 'owner', 'notes.save', {
      note: { ...first, folder: 'Elsewhere' },
      baseUpdatedAt: first.updatedAt,
    })
  ).value;
  assert.ok(moved);
  assert.equal((await cloud(db, guest, 'shared.get', { owner: 'owner', id: 'one' })).status, 403);
  await cloud(db, owner, 'shares.revoke', { kind: 'folder', id: 'Clients/Acme', email: guest.email });
  assert.equal((await cloud(db, guest, 'shared.list')).value.length, 0);
  assert.equal((await cloud(db, guest, 'shared.get', { owner: 'owner', id: 'two' })).status, 403);
});
test('task calendar escapes injected lines and never adds an attendee or invitation', () => {
  const n = note('n', {
    details: {
      ...emptyDetails(),
      actions: [
        {
          id: 'a',
          text: 'Plan\nATTENDEE:evil@example.test',
          owner: 'Priya',
          due: '2026-10-30',
          done: false,
          segmentId: '',
        },
      ],
    },
  });
  const ics = actionsCalendar(n);
  assert.match(ics, /BEGIN:VTODO/);
  assert.ok(!ics.includes('\r\nATTENDEE:'));
  assert.ok(!ics.includes('METHOD:REQUEST'));
  assert.match(ics, /DUE;VALUE=DATE:20261030/);
});
