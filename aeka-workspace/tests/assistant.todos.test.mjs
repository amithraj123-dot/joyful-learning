// To-dos, round 2: quick add, lists, the doing status, repeats, stale and critical flags, to-dos from
// other modules (once each, dismissed when deleted) and Scribe action items.
import test from 'node:test';
import assert from 'node:assert/strict';
import { saveNote } from '../lib/cloud-store.ts';
import { emptyDetails } from '../lib/note-details.ts';
import { getMember } from '../core/server/members.ts';
import { memberContext } from '../modules/assistant/server/context.ts';
import { parseQuickAdd } from '../modules/assistant/server/quickadd.ts';
import { nextTodoDue } from '../modules/assistant/server/records.ts';
import { addTodoFrom } from '../modules/assistant/server/services.ts';
import { runTool } from '../modules/assistant/server/tools.ts';
import { firm, people } from './fixtures/workflow-firm.mjs';

const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ist = (s) => Date.parse(s + '+05:30');
const iso = (ms) => (ms == null ? null : new Date(ms + 330 * MIN).toISOString().slice(0, 16));
// Tuesday 27 Oct 2026, 10:00 am India time.
const NOW = ist('2026-10-27T10:00:00');
const okAs = (send) => async (who, action, payload) => {
  const r = await send(who, 'assistant', action, payload);
  if (r.status !== 200) throw new Error(`${action} by ${who}: ${r.status} ${r.error}`);
  return r.value;
};

test('quick add reads dates, times, lists, priority and repeats in India time, without AI', () => {
  const read = (text, now = NOW) => {
    const q = parseQuickAdd(text, now);
    return [q.title, iso(q.dueAt), q.list, q.priority, q.repeat];
  };
  const cases = [
    [
      'Send Rahul the valuation note tomorrow 4pm #Falcon !',
      ['Send Rahul the valuation note', '2026-10-28T16:00', 'Falcon', 'high', 'none'],
    ],
    // A date alone means the end of the day; a number in a title is never a time.
    ['File Form 15CA on 3 Nov', ['File Form 15CA', '2026-11-03T18:00', '', 'normal', 'none']],
    ['Form 15CA filing for Kite', ['Form 15CA filing for Kite', null, '', 'normal', 'none']],
    ['Review Section 194 note', ['Review Section 194 note', null, '', 'normal', 'none']],
    ['Withholding at 10% on royalty', ['Withholding at 10% on royalty', null, '', 'normal', 'none']],
    ['Send update today', ['Send update', '2026-10-27T18:00', '', 'normal', 'none']],
    ['Send update EOD', ['Send update', '2026-10-27T18:00', '', 'normal', 'none']],
    ['Review the SPA by end of day', ['Review the SPA', '2026-10-27T18:00', '', 'normal', 'none']],
    [
      'Review Section 194 note by Friday EOD',
      ['Review Section 194 note', '2026-10-30T18:00', '', 'normal', 'none'],
    ],
    // Weekdays: the coming one (a week today for today's weekday); "next" means next week.
    ['Wednesday prep', ['Prep', '2026-10-28T18:00', '', 'normal', 'none']],
    ['Tuesday prep', ['Prep', '2026-11-03T18:00', '', 'normal', 'none']],
    ['Board pack next Friday', ['Board pack', '2026-11-06T18:00', '', 'normal', 'none']],
    [
      'Call Sun Pharma CFO next Monday at 4',
      ['Call Sun Pharma CFO', '2026-11-02T16:00', '', 'normal', 'none'],
    ],
    ['Call Sun Pharma on Sunday', ['Call Sun Pharma', '2026-11-01T18:00', '', 'normal', 'none']],
    // Dates: day first, as in India; a date already past this year is next year's.
    ['Check status 3/11', ['Check status', '2026-11-03T18:00', '', 'normal', 'none']],
    ['Pay advance tax 15/12', ['Pay advance tax', '2026-12-15T18:00', '', 'normal', 'none']],
    ['Renew DSC on 3 Oct', ['Renew DSC', '2027-10-03T18:00', '', 'normal', 'none']],
    ['Lunch with banker on Nov 5th 1pm', ['Lunch with banker', '2026-11-05T13:00', '', 'normal', 'none']],
    ['Draft SPA comments by 2026-11-10', ['Draft SPA comments', '2026-11-10T18:00', '', 'normal', 'none']],
    ['Prepare memo in 3 days', ['Prepare memo', '2026-10-30T18:00', '', 'normal', 'none']],
    // Times: today if still ahead, otherwise tomorrow.
    ['Board call 16:30', ['Board call', '2026-10-27T16:30', '', 'normal', 'none']],
    ['Board call 9:00', ['Board call', '2026-10-28T09:00', '', 'normal', 'none']],
    ['Call Pia at 4', ['Call Pia', '2026-10-27T16:00', '', 'normal', 'none']],
    ['Call Pia at 11', ['Call Pia', '2026-10-27T11:00', '', 'normal', 'none']],
    ['Meet Rahul at 4.30 pm', ['Meet Rahul', '2026-10-27T16:30', '', 'normal', 'none']],
    ['Remind me at 6 pm to call the bank', ['Call the bank', '2026-10-27T18:00', '', 'normal', 'none']],
    ['Remind me in 2 hours to stretch', ['Stretch', '2026-10-27T12:00', '', 'normal', 'none']],
    // Repeats need a date: the given one, the weekday's, or today at the end of the day.
    ['Timesheet every Friday', ['Timesheet', '2026-10-30T18:00', '', 'normal', 'weekly']],
    ['Call mum every day at 9am', ['Call mum', '2026-10-28T09:00', '', 'normal', 'daily']],
    ['Partner review every fortnight', ['Partner review', '2026-10-27T18:00', '', 'normal', 'fortnightly']],
    ['Invoice run every month #Admin', ['Invoice run', '2026-10-27T18:00', 'Admin', 'normal', 'monthly']],
    ['Weekly digest review', ['Weekly digest review', null, '', 'normal', 'none']],
    // Lists and priority anywhere in the line.
    [
      '#Kite Prepare SPA markup ! on Nov 5',
      ['Prepare SPA markup', '2026-11-05T18:00', 'Kite', 'high', 'none'],
    ],
    ['Urgent! reply to Ananya', ['Urgent reply to Ananya', null, '', 'high', 'none']],
    ['Prepare note high priority', ['Prepare note', null, '', 'high', 'none']],
  ];
  for (const [text, expected] of cases) assert.deepEqual(read(text), expected, text);
  // After 6 pm, "today" without a time is still today; a repeat moves to the next occurrence.
  assert.deepEqual(read('Timesheet every Tuesday', ist('2026-10-27T19:00:00')).slice(1, 2), [
    '2026-11-03T18:00',
  ]);
  assert.deepEqual(read('Partner review every week', ist('2026-10-27T19:00:00')).slice(1, 2), [
    '2026-10-28T18:00',
  ]);
  // A repeating to-do whose first time has passed starts at its next occurrence, whatever the period.
  assert.deepEqual(read('Standup every day today at 9am').slice(1, 2), ['2026-10-28T09:00']);
  assert.deepEqual(read('Invoice run every month on 27 Oct', ist('2026-10-27T19:00:00')).slice(1, 2), [
    '2026-11-27T18:00',
  ]);
  // "today" said after 6 pm is due by midnight, not created overdue.
  assert.deepEqual(read('Call the bank today', ist('2026-10-27T19:00:00')).slice(0, 2), [
    'Call the bank',
    '2026-10-27T23:59',
  ]);
  // A day-first date without a year needs "by", "on" or "due", or to end the line; a fraction stays.
  assert.deepEqual(read('Review 1/2 of the deck').slice(0, 2), ['Review 1/2 of the deck', null]);
  assert.deepEqual(read('File TDS return by 7/11 for Kite').slice(0, 2), [
    'File TDS return for Kite',
    '2026-11-07T18:00',
  ]);
  assert.equal(
    parseQuickAdd('Send Rahul the valuation note tomorrow 4pm #Falcon ! every week', NOW).understood,
    'Read as "Send Rahul the valuation note"; due Wednesday, 28 Oct 2026, 4:00 pm; list Falcon; high priority; repeats every week.',
  );
  assert.equal(parseQuickAdd('Form 15CA', NOW).understood, 'Read as "Form 15CA"; no due date.');
  assert.throws(() => parseQuickAdd('#Falcon tomorrow 4pm', NOW), /Say what the to-do is/);
});

test('todo.quickAdd creates the to-do and explains the reading; the text is validated', async () => {
  const { send } = await firm();
  const ok = okAs(send);
  const { todo, understood } = await ok('associate', 'todo.quickAdd', {
    text: 'Call Rahul tomorrow 4pm #Falcon !',
  });
  assert.equal(todo.title, 'Call Rahul');
  assert.equal(todo.list, 'Falcon');
  assert.equal(todo.priority, 'high');
  assert.equal(todo.source, 'manual');
  assert.equal(new Date(todo.dueAt + 330 * MIN).toISOString().slice(11, 16), '16:00');
  assert.match(
    understood,
    /^Read as "Call Rahul"; due \w+day, \d+ \w{3} \d{4}, 4:00 pm; list Falcon; high priority\.$/,
  );
  assert.equal((await send('associate', 'assistant', 'todo.quickAdd', { text: '' })).status, 400);
  assert.equal(
    (await send('associate', 'assistant', 'todo.quickAdd', { text: 'x'.repeat(501) })).status,
    400,
  );
  assert.equal((await send('associate', 'assistant', 'todo.quickAdd', { text: 42 })).status, 400);
  // Undo is a delete; nobody else sees it.
  assert.equal((await ok('manager', 'todos.list', {})).length, 0);
  assert.equal(await ok('associate', 'todo.delete', { id: todo.id }), true);
  assert.equal((await ok('associate', 'todos.list', { includeDone: true })).length, 0);
});

test('to-dos have lists, a doing status, repeats and stale or critical flags', async () => {
  const { send, db } = await firm();
  const ok = okAs(send);
  const a = (action, payload) => send('associate', 'assistant', action, payload);
  const now = Date.now();
  // A repeating to-do needs a due date; lists drop a leading #.
  assert.match(
    (await a('todo.create', { todo: { title: 'Timesheet', repeat: 'weekly' } })).error,
    /due date/,
  );
  assert.equal((await a('todo.create', { todo: { title: 'x', repeat: 'yearly', dueAt: now } })).status, 400);
  assert.equal((await a('todo.create', { todo: { title: 'x', list: 'y'.repeat(41) } })).status, 400);
  const weekly = await ok('associate', 'todo.create', {
    todo: { title: 'Timesheet', list: '#Admin', priority: 'high', dueAt: now - HOUR, repeat: 'weekly' },
  });
  assert.equal(weekly.list, 'Admin');
  assert.equal(weekly.repeat, 'weekly');
  assert.equal(weekly.sourceLabel, '');
  // Doing counts as open; an edit without list or repeat keeps them.
  const doing = await ok('associate', 'todo.update', {
    id: weekly.id,
    todo: { title: 'Timesheet', priority: 'high', dueAt: weekly.dueAt, status: 'doing' },
    baseRevision: 1,
  });
  assert.equal(doing.status, 'doing');
  assert.equal(doing.list, 'Admin');
  assert.equal(doing.repeat, 'weekly');
  assert.deepEqual(
    (await ok('associate', 'todos.list', {})).map((t) => t.status),
    ['doing'],
  );
  // Completing it creates the next one, a week on at the same time, in the same list.
  const done = await ok('associate', 'todo.update', {
    id: weekly.id,
    todo: { title: 'Timesheet', priority: 'high', dueAt: weekly.dueAt, status: 'done' },
    baseRevision: 2,
  });
  assert.equal(done.status, 'done');
  const open = await ok('associate', 'todos.list', {});
  assert.equal(open.length, 1);
  assert.equal(open[0].title, 'Timesheet');
  assert.equal(open[0].dueAt, weekly.dueAt + 7 * DAY);
  assert.equal(open[0].list, 'Admin');
  assert.equal(open[0].priority, 'high');
  assert.equal(open[0].repeat, 'weekly');
  assert.equal(open[0].sourceRef, '');
  // Reopening and completing again does not make a second successor; a stale revision makes none.
  const reopened = await ok('associate', 'todo.update', {
    id: weekly.id,
    todo: { title: 'Timesheet', priority: 'high', dueAt: weekly.dueAt, status: 'open' },
    baseRevision: 3,
  });
  assert.equal(reopened.doneAt, null);
  await ok('associate', 'todo.update', {
    id: weekly.id,
    todo: { title: 'Timesheet', priority: 'high', dueAt: weekly.dueAt, status: 'done' },
    baseRevision: 4,
  });
  assert.equal((await ok('associate', 'todos.list', {})).length, 1);
  const daily = await ok('associate', 'todo.create', {
    todo: { title: 'Check mail', dueAt: now + HOUR, repeat: 'daily' },
  });
  await ok('associate', 'todo.update', {
    id: daily.id,
    todo: { title: 'Renamed', dueAt: now + HOUR },
    baseRevision: 1,
  });
  const stale = await a('todo.update', {
    id: daily.id,
    todo: { title: 'Renamed', dueAt: now + HOUR, status: 'done' },
    baseRevision: 1,
  });
  assert.equal(stale.status, 409);
  assert.equal((await ok('associate', 'todos.list', {})).filter((t) => t.title === 'Renamed').length, 1);
  // The chat tool completes it and reports the next one.
  const ctx = memberContext(
    { db, env: {}, fetch: () => Promise.reject(new Error('offline')), now },
    await getMember(db, people.associate.email),
  );
  const tool = await runTool({ ctx, channel: 'web' }, 'complete_todo', JSON.stringify({ id: daily.id }));
  assert.equal(tool.note.ok, true);
  assert.match(tool.note.summary, /^Marked done: Renamed; next due /);
  assert.equal(JSON.parse(tool.content).result.next.due != null, true);

  // Flags: open more than 7 days without a date is stale; 3 or more days overdue is critical.
  const insert = db.sql.prepare(
    "INSERT INTO as_todos(id,member,title,details,status,priority,due_at,source,source_ref,task_id,created_at,updated_at,done_at,revision) VALUES(?,?,?,'',?,'normal',?,'manual','',NULL,?,?,NULL,1)",
  );
  const me = people.associate.email;
  insert.run('old', me, 'Old idea', 'open', null, now - 8 * DAY, now - 8 * DAY);
  insert.run('young', me, 'New idea', 'open', null, now - 6 * DAY, now - 6 * DAY);
  insert.run('late', me, 'Late filing', 'open', now - 3 * DAY - MIN, now - 9 * DAY, now - 9 * DAY);
  insert.run('slightly', me, 'Slightly late', 'doing', now - 2 * DAY, now - 9 * DAY, now - 9 * DAY);
  insert.run('finished', me, 'Finished', 'done', now - 9 * DAY, now - 9 * DAY, now - 9 * DAY);
  const all = new Map((await ok('associate', 'todos.list', { includeDone: true })).map((t) => [t.id, t]));
  assert.deepEqual(
    ['old', 'young', 'late', 'slightly', 'finished'].map((id) => [all.get(id).stale, all.get(id).critical]),
    [
      [true, false],
      [false, false],
      [false, true],
      [false, false],
      [false, false],
    ],
  );
  // A doing to-do can be moved to a task like an open one.
  assert.equal(all.get('slightly').status, 'doing');
});

test('the next due date of a repeating to-do keeps the time in India time and skips missed periods', () => {
  const at = (s) => ist(s);
  assert.equal(
    iso(nextTodoDue(at('2026-10-27T18:00:00'), 'daily', at('2026-10-27T10:00:00'))),
    '2026-10-28T18:00',
  );
  // Completed four days late: the first occurrence after now.
  assert.equal(
    iso(nextTodoDue(at('2026-10-20T09:00:00'), 'daily', at('2026-10-24T10:00:00'))),
    '2026-10-25T09:00',
  );
  assert.equal(
    iso(nextTodoDue(at('2026-10-20T09:00:00'), 'weekly', at('2026-10-24T10:00:00'))),
    '2026-10-27T09:00',
  );
  assert.equal(
    iso(nextTodoDue(at('2026-10-20T09:00:00'), 'fortnightly', at('2026-10-21T10:00:00'))),
    '2026-11-03T09:00',
  );
  // Monthly from the 31st: the last day of a shorter month, then back to the 31st.
  assert.equal(
    iso(nextTodoDue(at('2027-01-31T00:30:00'), 'monthly', at('2027-01-30T00:00:00'))),
    '2027-02-28T00:30',
  );
  assert.equal(
    iso(nextTodoDue(at('2027-01-31T00:30:00'), 'monthly', at('2027-03-01T00:00:00'))),
    '2027-03-31T00:30',
  );
  assert.equal(nextTodoDue(at('2026-10-27T18:00:00'), 'none', NOW), null);
  // With the day kept to, a successor on the 28th goes back to the 31st, even after two short months.
  assert.equal(
    iso(nextTodoDue(at('2027-02-28T00:30:00'), 'monthly', at('2027-02-27T00:00:00'), 31)),
    '2027-03-31T00:30',
  );
  assert.equal(
    iso(nextTodoDue(at('2027-04-30T00:30:00'), 'monthly', at('2027-04-29T00:00:00'), 31)),
    '2027-05-31T00:30',
  );
});

test('a monthly to-do from the 31st keeps to the 31st through its successors', async () => {
  const { db } = await firm();
  const member = await getMember(db, people.associate.email);
  const ctxAt = (now) =>
    memberContext({ db, env: {}, fetch: () => Promise.reject(new Error('offline')), now }, member);
  const { createTodo, completeTodo, successorOf, updateTodo } =
    await import('../modules/assistant/server/records.ts');
  const first = await createTodo(ctxAt(ist('2027-01-20T10:00:00')), {
    title: 'GST return',
    details: '',
    priority: 'normal',
    dueAt: ist('2027-01-31T18:00:00'),
    repeat: 'monthly',
  });
  const dues = [];
  let todo = first;
  for (const when of ['2027-01-30', '2027-02-27', '2027-03-30', '2027-04-29']) {
    const ctx = ctxAt(ist(`${when}T10:00:00`));
    await completeTodo(ctx, todo.id);
    todo = await successorOf(ctx, todo.id);
    dues.push(iso(todo.dueAt));
  }
  assert.deepEqual(dues, ['2027-02-28T18:00', '2027-03-31T18:00', '2027-04-30T18:00', '2027-05-31T18:00']);
  // A new due date sets the day again.
  const ctx = ctxAt(ist('2027-05-01T10:00:00'));
  const moved = await updateTodo(ctx, todo.id, { ...todo, dueAt: ist('2027-05-15T18:00:00') }, todo.revision);
  await completeTodo(ctx, moved.id);
  assert.equal(iso((await successorOf(ctx, moved.id)).dueAt), '2027-06-15T18:00');
});

test('addTodoFrom adds each source item once; deleting it dismisses it for good', async () => {
  const { send, db } = await firm();
  const ok = okAs(send);
  const ctxOf = async (who, now = Date.now()) =>
    memberContext(
      { db, env: {}, fetch: () => Promise.reject(new Error('offline')), now },
      await getMember(db, people[who].email),
    );
  const ctx = await ctxOf('associate');
  const input = {
    title: '  Confirm the tax indemnity cap  ',
    details: 'Also check the escrow',
    dueAt: ist('2026-10-28T18:00:00'),
    priority: 'high',
    list: '#Kestrel',
    source: 'mail',
    sourceRef: 'mail-1',
    sourceLabel: 'Project Kestrel: SPA closing moved to 28 Oct',
  };
  const todo = await addTodoFrom(ctx, input);
  assert.equal(todo.title, 'Confirm the tax indemnity cap');
  assert.equal(todo.source, 'mail');
  assert.equal(todo.sourceRef, 'mail-1');
  assert.equal(todo.sourceLabel, 'Project Kestrel: SPA closing moved to 28 Oct');
  assert.equal(todo.list, 'Kestrel');
  assert.equal(todo.priority, 'high');
  assert.equal(await addTodoFrom(ctx, input), null);
  // Another member's item with the same reference is theirs alone.
  const theirs = await addTodoFrom(await ctxOf('manager'), input);
  assert.ok(theirs);
  assert.equal((await ok('associate', 'todos.list', {})).length, 1);
  // Deleting a sourced to-do hides it and keeps it from coming back; completing it also keeps it out.
  assert.equal(await ok('associate', 'todo.delete', { id: todo.id }), true);
  assert.equal((await ok('associate', 'todos.list', { includeDone: true })).length, 0);
  assert.equal((await send('associate', 'assistant', 'todo.delete', { id: todo.id })).status, 404);
  assert.equal(await addTodoFrom(ctx, input), null);
  assert.equal(db.sql.prepare("SELECT count(*) AS n FROM as_todos WHERE source_ref = 'mail-1'").get().n, 2);
  const promise = await addTodoFrom(ctx, {
    ...input,
    source: 'commitment',
    sourceRef: 'sent-1:0',
    title: 'Send the note',
  });
  await ok('associate', 'todo.update', {
    id: promise.id,
    todo: { title: promise.title, dueAt: promise.dueAt, status: 'done' },
    baseRevision: 1,
  });
  assert.equal(await addTodoFrom(ctx, { ...input, source: 'commitment', sourceRef: 'sent-1:0' }), null);
  // A manual to-do is really deleted.
  const manual = await ok('associate', 'todo.create', { todo: { title: 'Mine' } });
  await ok('associate', 'todo.delete', { id: manual.id });
  assert.equal(db.sql.prepare('SELECT count(*) AS n FROM as_todos WHERE id = ?').get(manual.id).n, 0);
  // Inputs from other modules are tidied, not trusted.
  const long = await addTodoFrom(ctx, {
    ...input,
    sourceRef: 'mail-2',
    title: 'x'.repeat(400),
    dueAt: 'soon',
    list: '',
  });
  assert.equal(long.title.length, 240);
  assert.equal(long.dueAt, null);
  await assert.rejects(addTodoFrom(ctx, { ...input, sourceRef: 'mail-3', title: '   ' }), /title/);
  await assert.rejects(addTodoFrom(ctx, { ...input, sourceRef: '' }), /source/);
  await assert.rejects(addTodoFrom(ctx, { ...input, sourceRef: 'x', source: 'manual' }), /source/);
});

const note = (over = {}, actions = []) => ({
  id: 'kickoff-1',
  title: 'Falcon kick-off with the buyer',
  kind: 'meeting',
  createdAt: Date.UTC(2026, 9, 20, 5),
  updatedAt: 0,
  body: 'My private working notes',
  summary: 'Agreed the diligence scope.',
  folder: '',
  segments: [],
  speakers: {},
  eventId: '',
  status: 'complete',
  duration: 80,
  details: { ...emptyDetails(), attendees: [], eventStart: '2026-10-21T04:30:00.000Z', actions },
  ...over,
});
const action = (id, text, owner = '', due = '', done = false) => ({
  id,
  text,
  owner,
  due,
  done,
  segmentId: '',
});

test("notes.toTodos adds my own note's open action items once each, linked to the note", async () => {
  const { send, db } = await firm();
  const ok = okAs(send);
  const u = people.associate;
  await saveNote(
    db,
    u.userId,
    note({}, [
      action('a1', 'Share the data room index', 'Pia', '2026-10-30'),
      action('a2', 'Send the diligence request list'),
      action('a3', 'Already done', '', '', true),
    ]),
    undefined,
    u.email,
  );
  const first = await ok('associate', 'notes.toTodos', { noteId: 'kickoff-1' });
  assert.equal(first.added.length, 2);
  assert.equal(first.skipped, 1);
  const [t1, t2] = first.added;
  assert.equal(t1.title, 'Share the data room index');
  assert.equal(t1.source, 'meeting');
  assert.equal(t1.sourceRef, 'kickoff-1:a1');
  assert.equal(t1.sourceLabel, 'Falcon kick-off with the buyer');
  assert.equal(iso(t1.dueAt), '2026-10-30T18:00');
  assert.match(t1.details, /Owner: Pia/);
  assert.equal(t2.dueAt, null);
  const again = await ok('associate', 'notes.toTodos', { noteId: 'kickoff-1' });
  assert.deepEqual([again.added.length, again.skipped], [0, 3]);
  // Only my own notes: another member's request for the same id finds nothing.
  assert.equal((await send('manager', 'assistant', 'notes.toTodos', { noteId: 'kickoff-1' })).status, 404);
  assert.equal((await send('associate', 'assistant', 'notes.toTodos', { noteId: '../x' })).status, 400);
  assert.equal((await ok('manager', 'todos.list', {})).length, 0);
});
