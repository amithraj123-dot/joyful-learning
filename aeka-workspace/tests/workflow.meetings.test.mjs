import test from 'node:test';
import assert from 'node:assert/strict';
import { saveNote } from '../lib/cloud-store.ts';
import { emptyDetails } from '../lib/note-details.ts';
import { firm, people } from './fixtures/workflow-firm.mjs';

const meeting = (over = {}, actions = []) => ({
  id: 'kickoff-1',
  title: 'Falcon kick-off with the buyer',
  kind: 'meeting',
  createdAt: Date.UTC(2026, 9, 20, 5),
  updatedAt: 0,
  body: 'My private working notes',
  summary: 'Agreed the diligence scope and the timetable.',
  folder: '',
  segments: [
    { id: 's2', start: 75, end: 80, text: 'We will share the data room index.', speaker: 'B' },
    { id: 's1', start: 3, end: 9, text: 'Thank you for joining.', speaker: 'A' },
  ],
  speakers: { A: 'Pia Nair', B: 'Buyer counsel' },
  eventId: '',
  status: 'complete',
  duration: 80,
  details: {
    ...emptyDetails(),
    attendees: ['pia@aeka.example', 'counsel@buyer.example'],
    eventStart: '2026-10-21T04:30:00.000Z',
    actions,
  },
  ...over,
});
const item = (id, text, owner = '', due = '') => ({ id, text, owner, due, done: false, segmentId: '' });

// Saves a note in the person's own Scribe workspace, as the web app does.
async function noteFor(db, who, note) {
  const u = people[who];
  const old = await db
    .prepare('SELECT updated_at FROM workspace_notes WHERE owner = ? AND id = ?')
    .bind(u.userId, note.id)
    .first();
  return saveNote(db, u.userId, note, old?.updated_at, u.email);
}

test('only the owner can link a note, and only their own note on a mandate they can see', async () => {
  const { db, wf, ok, open, walled } = await firm();
  await noteFor(db, 'associate', meeting());
  const link = (who, matterId, noteId = 'kickoff-1') =>
    wf(who, 'meetings.link', { noteId, matterId, includeTranscript: false });
  // Another person's note is not found, whoever asks.
  assert.equal((await link('admin', open.id)).status, 404);
  assert.equal((await link('manager', open.id)).status, 404);
  assert.equal((await link('associate', open.id, 'missing')).status, 404);
  // Not a firm member.
  assert.equal((await link('outsider', open.id)).status, 403);
  // A restricted mandate outside the caller's wall is reported as not found.
  await noteFor(db, 'article', meeting());
  assert.equal((await link('article', walled.id)).status, 404);
  // The associate is on Project Kite's team.
  const shared = await ok('associate', 'meetings.link', {
    noteId: 'kickoff-1',
    matterId: walled.id,
    includeTranscript: false,
  });
  assert.equal(shared.linkedBy, people.associate.email);
  assert.equal(shared.ownerUser, undefined);
  assert.equal(shared.meetingAt, Date.parse('2026-10-21T04:30:00.000Z'));
  assert.equal((await wf('manager', 'meetings.list', { matterId: walled.id })).status, 404);
  assert.equal((await ok('partner', 'meetings.list', { matterId: walled.id })).length, 1);
  // Trashed notes cannot be shared.
  await noteFor(db, 'article', meeting({ details: { ...meeting().details, trashedAt: Date.now() } }));
  assert.match((await link('article', open.id)).error, /trash/);
});

test('the shared copy holds the summary and actions, never the private notes; the transcript only if chosen', async () => {
  const { db, ok, open } = await firm();
  await noteFor(db, 'manager', meeting({}, [item('a1', 'Share the data room index', 'Pia', '2026-10-25')]));
  const link = await ok('manager', 'meetings.link', {
    noteId: 'kickoff-1',
    matterId: open.id,
    includeTranscript: false,
  });
  const [listed] = await ok('associate', 'meetings.list', { matterId: open.id });
  assert.deepEqual(listed, link);
  assert.equal(listed.summary, 'Agreed the diligence scope and the timetable.');
  assert.deepEqual(listed.attendees, ['pia@aeka.example', 'counsel@buyer.example']);
  assert.deepEqual(listed.actions, [
    { id: 'a1', text: 'Share the data room index', owner: 'Pia', due: '2026-10-25', taskId: null },
  ]);
  assert.ok(!JSON.stringify(listed).includes('My private working notes'));
  assert.equal(listed.transcriptChars, 0);
  assert.deepEqual(await ok('associate', 'meetings.transcript', { id: link.id }), { transcript: '' });
  // The owner chooses to share the transcript: segments in order, with speaker names.
  const withTranscript = await ok('manager', 'meetings.link', {
    noteId: 'kickoff-1',
    matterId: open.id,
    includeTranscript: true,
  });
  assert.equal(withTranscript.id, link.id);
  assert.equal(withTranscript.revision, 2);
  const { transcript } = await ok('associate', 'meetings.transcript', { id: link.id });
  assert.equal(
    transcript,
    '[00:03] Pia Nair: Thank you for joining.\n[01:15] Buyer counsel: We will share the data room index.',
  );
  assert.equal(withTranscript.transcriptChars, transcript.length);
  // And can withdraw it again.
  await ok('manager', 'meetings.link', { noteId: 'kickoff-1', matterId: open.id, includeTranscript: false });
  assert.deepEqual(await ok('associate', 'meetings.transcript', { id: link.id }), { transcript: '' });
  const count = db.sql.prepare('SELECT count(*) AS n FROM wf_meeting_transcripts').get();
  assert.equal(count.n, 0);
});

test('action items become tasks once; updating the copy keeps the tasks', async () => {
  const { db, wf, ok, open, walled } = await firm();
  const actions = [item('a1', 'Share the data room index', 'Pia'), item('a2', 'Circulate the timetable')];
  await noteFor(db, 'manager', meeting({}, actions));
  let link = await ok('manager', 'meetings.link', {
    noteId: 'kickoff-1',
    matterId: open.id,
    includeTranscript: false,
  });
  const create = (who, items, base = link.revision) =>
    wf(who, 'meetings.createTasks', { id: link.id, baseRevision: base, items });
  const one = { actionId: 'a1', title: 'Share the data room index', assignee: null, dueDate: '2026-10-30' };
  // Assignees must be able to see the mandate, as with any task.
  await noteFor(db, 'associate', meeting({ id: 'kite-1' }, actions));
  const kite = await ok('associate', 'meetings.link', {
    noteId: 'kite-1',
    matterId: walled.id,
    includeTranscript: false,
  });
  const walledTask = await wf('associate', 'meetings.createTasks', {
    id: kite.id,
    baseRevision: kite.revision,
    items: [{ ...one, assignee: people.manager.email }],
  });
  assert.equal(walledTask.status, 400);
  assert.match(walledTask.error, /cannot see this restricted matter/);

  const first = await create('associate', [{ ...one, assignee: people.associate.email }]);
  assert.equal(first.status, 200);
  const [task] = first.value.tasks;
  assert.equal(task.matterId, open.id);
  assert.equal(task.assignee, people.associate.email);
  assert.equal(task.dueDate, '2026-10-30');
  assert.equal(task.createdBy, people.associate.email);
  assert.match(task.notes, /From the meeting "Falcon kick-off with the buyer"; owner in the note: Pia/);
  link = first.value.link;
  assert.equal(link.actions[0].taskId, task.id);
  // A stale revision is refused and creates nothing.
  assert.equal((await create('manager', [{ ...one, actionId: 'a2' }], link.revision - 1)).status, 409);
  // The same item cannot produce a second task.
  assert.equal((await create('manager', [one])).status, 409);
  // Someone else saves the link between this request's read and its write: nothing is created.
  const batch = db.batch;
  db.batch = async (statements) => {
    db.batch = batch;
    db.sql.prepare('UPDATE wf_meeting_links SET revision = revision + 1 WHERE id = ?').run(link.id);
    return batch(statements);
  };
  const raced = await create('manager', [{ ...one, actionId: 'a2', title: 'Circulate the timetable' }]);
  assert.equal(raced.status, 409);
  db.sql.prepare('UPDATE wf_meeting_links SET revision = revision - 1 WHERE id = ?').run(link.id);
  const snapshot = await ok('manager', 'snapshot');
  assert.equal(snapshot.tasks.filter((t) => t.matterId === open.id).length, 1);

  // The owner edits the note (removes a1, rewords a2) and updates the shared copy.
  await noteFor(db, 'manager', meeting({}, [item('a2', 'Circulate the revised timetable')]));
  link = await ok('manager', 'meetings.link', {
    noteId: 'kickoff-1',
    matterId: open.id,
    includeTranscript: false,
  });
  assert.deepEqual(
    link.actions.map((a) => [a.id, a.text, a.taskId]),
    [
      ['a2', 'Circulate the revised timetable', null],
      ['a1', 'Share the data room index', task.id],
    ],
  );
  const second = await create('manager', [
    { actionId: 'a2', title: 'Circulate the revised timetable', assignee: null, dueDate: null },
  ]);
  assert.equal(second.status, 200);
  assert.equal((await ok('manager', 'snapshot')).tasks.filter((t) => t.matterId === open.id).length, 2);
});

test('the owner or a Manager and above can unlink; tasks stay; links follow the note for its owner', async () => {
  const { db, wf, ok, send, client, open } = await firm();
  await noteFor(db, 'associate', meeting({}, [item('a1', 'Share the data room index')]));
  const link = await ok('associate', 'meetings.link', {
    noteId: 'kickoff-1',
    matterId: open.id,
    includeTranscript: true,
  });
  const forNote = await ok('associate', 'meetings.forNote', { noteId: 'kickoff-1' });
  assert.deepEqual(
    forNote.map((x) => [x.id, x.clientName, x.matterTitle]),
    [[link.id, client.name, open.title]],
  );
  // Another person sees nothing for the same note id: notes are per owner.
  assert.deepEqual(await ok('manager', 'meetings.forNote', { noteId: 'kickoff-1' }), []);
  const targets = await ok('article', 'meetings.targets');
  assert.deepEqual(
    targets.map((t) => t.title),
    ['Project Falcon'],
  );
  const { value } = await wf('associate', 'meetings.createTasks', {
    id: link.id,
    baseRevision: link.revision,
    items: [{ actionId: 'a1', title: 'Share the data room index', assignee: null, dueDate: null }],
  });
  assert.equal((await wf('article', 'meetings.unlink', { id: link.id })).status, 403);
  assert.equal((await wf('am', 'meetings.unlink', { id: link.id })).status, 200);
  assert.deepEqual(await ok('associate', 'meetings.list', { matterId: open.id }), []);
  assert.equal(db.sql.prepare('SELECT count(*) AS n FROM wf_meeting_transcripts').get().n, 0);
  const tasks = (await ok('associate', 'snapshot')).tasks;
  assert.ok(tasks.some((t) => t.id === value.tasks[0].id));
  const trail = await send('admin', 'core', 'activity.list', { target: link.id });
  assert.deepEqual(
    trail.value.map((e) => e.summary),
    [
      'Removed meeting note "Falcon kick-off with the buyer" from Project Falcon',
      'Linked meeting note "Falcon kick-off with the buyer" to Project Falcon, with its transcript',
    ],
  );
});

test('two first links of the same note at once leave one link and no stray transcript', async () => {
  const { db, wf, ok, open } = await firm();
  await noteFor(db, 'manager', meeting());
  const payload = { noteId: 'kickoff-1', matterId: open.id, includeTranscript: true };
  // The other request's link lands between this request's read and its write.
  const batch = db.batch;
  db.batch = async (statements) => {
    db.batch = batch;
    await ok('manager', 'meetings.link', payload);
    return batch(statements);
  };
  const late = await wf('manager', 'meetings.link', payload);
  assert.equal(late.status, 409);
  assert.equal((await ok('associate', 'meetings.list', { matterId: open.id })).length, 1);
  assert.equal(db.sql.prepare('SELECT count(*) AS n FROM wf_meeting_transcripts').get().n, 1);
});
