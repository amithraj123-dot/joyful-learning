import test from 'node:test';
import assert from 'node:assert/strict';
import { notesMCP } from '../lib/notes-mcp.ts';
import { database } from './helpers/database.mjs';
const note = {
  id: 'private-id',
  title: 'Review GST',
  kind: 'scratchpad',
  createdAt: 1,
  updatedAt: 1,
  folder: 'Tax',
  body: 'Owner-only details',
  summary: '',
  segments: [],
  speakers: {},
  eventId: '',
  status: 'draft',
  duration: 0,
};
const req = (method, params = {}) =>
  new Request('https://flow.example/mcp', {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
test('MCP advertises only read-only tools and denies unauthenticated note reads', async () => {
  const list = await (await notesMCP(req('tools/list'), undefined, null)).json();
  assert.deepEqual(
    list.result.tools.map((t) => t.name),
    ['search_notes', 'get_note'],
  );
  assert.ok(list.result.tools.every((t) => t.annotations.readOnlyHint));
  const response = await (
    await notesMCP(req('tools/call', { name: 'get_note', arguments: { id: note.id } }), database(), null)
  ).json();
  assert.equal(response.result.isError, true);
});
test('MCP search and retrieval enforce ownership, literal queries and the cloud-AI policy', async () => {
  const db = database();
  db.sql
    .prepare('INSERT INTO workspace_notes VALUES(?,?,?,?)')
    .run('owner', note.id, JSON.stringify(note), 1);
  const call = async (user, name, args) =>
    (await (await notesMCP(req('tools/call', { name, arguments: args }), db, user)).json()).result;
  const search = await call('owner', 'search_notes', { query: 'GST' });
  assert.equal(JSON.parse(search.content[0].text)[0].id, note.id);
  assert.deepEqual(JSON.parse((await call('owner', 'search_notes', { query: '%' })).content[0].text), []);
  assert.deepEqual(JSON.parse((await call('other', 'search_notes', { query: '' })).content[0].text), []);
  assert.equal((await call('other', 'get_note', { id: note.id })).isError, true);
  assert.match((await call('owner', 'get_note', { id: note.id })).content[0].text, /Owner-only details/);
  db.sql.prepare('INSERT INTO workspace_policy VALUES(?,?)').run('owner', JSON.stringify({ cloudAI: false }));
  assert.equal((await call('owner', 'get_note', { id: note.id })).isError, true);
});
