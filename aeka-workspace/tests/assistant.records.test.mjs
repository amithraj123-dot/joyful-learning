import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assistantServer } from '../modules/assistant/server/index.ts';
import { styleNotes } from '../modules/assistant/server/services.ts';
import { firm, people } from './fixtures/workflow-firm.mjs';

const HOUR = 3600000;
const as = (send) => (who, action, payload) => send(who, 'assistant', action, payload);
const okAs = (send) => async (who, action, payload) => {
  const r = await send(who, 'assistant', action, payload);
  if (r.status !== 200) throw new Error(`${action} by ${who}: ${r.status} ${r.error}`);
  return r.value;
};

test('the server implements exactly the actions of the shared contract', () => {
  const contract = readFileSync(new URL('../modules/assistant/shared/contract.ts', import.meta.url), 'utf8');
  const start = contract.indexOf('export interface AssistantActions');
  const block = contract.slice(start, contract.indexOf('\n}\n', start));
  const names = [...block.matchAll(/^ {2}'?([\w.]+)'?: \{/gm)].map((m) => m[1]).sort();
  assert.ok(names.length >= 20);
  assert.deepEqual(Object.keys(assistantServer.actions).sort(), names);
  assert.equal(typeof assistantServer.tick, 'function');
});

test('to-dos are private to their owner, administrators included, and nothing goes to the firm trail', async () => {
  const { send, db } = await firm();
  const a = as(send);
  const ok = okAs(send);
  const todo = await ok('associate', 'todo.create', {
    todo: {
      title: 'Call Rahul about the SPA',
      details: 'Ask about the indemnity cap',
      priority: 'high',
      dueAt: null,
    },
  });
  assert.equal(todo.status, 'open');
  assert.equal(todo.source, 'manual');
  assert.equal(todo.revision, 1);
  assert.equal((await ok('associate', 'todos.list', {})).length, 1);
  assert.equal((await ok('admin', 'todos.list', {})).length, 0);
  // Another member's id is not found, whoever asks.
  for (const who of ['admin', 'manager']) {
    assert.equal(
      (await a(who, 'todo.update', { id: todo.id, todo: { title: 'x' }, baseRevision: 1 })).status,
      404,
    );
    assert.equal((await a(who, 'todo.delete', { id: todo.id })).status, 404);
  }
  assert.equal((await a('outsider', 'todos.list', {})).status, 403);
  // Revision checks.
  const done = await ok('associate', 'todo.update', {
    id: todo.id,
    todo: { ...todo, status: 'done' },
    baseRevision: 1,
  });
  assert.equal(done.status, 'done');
  assert.ok(done.doneAt);
  assert.equal(
    (await a('associate', 'todo.update', { id: todo.id, todo: { title: 'Again' }, baseRevision: 1 })).status,
    409,
  );
  // An edit without a status keeps it done.
  const renamed = await ok('associate', 'todo.update', {
    id: todo.id,
    todo: { title: 'Called Rahul', details: '', priority: 'normal', dueAt: null },
    baseRevision: 2,
  });
  assert.equal(renamed.status, 'done');
  assert.equal(renamed.doneAt, done.doneAt);
  assert.equal((await ok('associate', 'todos.list', {})).length, 0);
  assert.equal((await ok('associate', 'todos.list', { includeDone: true })).length, 1);
  assert.equal(await ok('associate', 'todo.delete', { id: todo.id }), true);
  const trail = db.sql.prepare("SELECT count(*) AS n FROM org_activity WHERE module = 'assistant'").get();
  assert.equal(trail.n, 0);
});

test('records are validated: lengths, choices, ids and limits', async () => {
  const { send, db } = await firm();
  const a = as(send);
  const create = (todo) => a('associate', 'todo.create', { todo });
  assert.equal((await create({ title: '' })).status, 400);
  assert.match((await create({ title: 'x'.repeat(241) })).error, /240/);
  assert.match((await create({ title: 'ok', details: 'x'.repeat(5001) })).error, /5,000/);
  assert.equal((await create({ title: 'ok', priority: 'urgent' })).status, 400);
  assert.equal((await create({ title: 'ok', dueAt: 'tomorrow' })).status, 400);
  assert.equal((await a('associate', 'todo.delete', { id: "1' OR 1=1" })).status, 404);
  const memory = (m) => a('associate', 'memory.save', { memory: m });
  assert.equal(
    (await memory({ category: 'style', title: 'Sign-off', content: 'x'.repeat(4001) })).status,
    400,
  );
  assert.equal((await memory({ category: 'secret', title: 'x', content: 'y' })).status, 400);
  assert.match(
    (await memory({ category: 'general', title: 'Bank', content: 'My password is hunter2' })).error,
    /password/,
  );
  assert.match(
    (await memory({ category: 'general', title: 'Card', content: 'Card 4111 1111 1111 1111' })).error,
    /card/,
  );
  // At most 500 open to-dos.
  const now = Date.now();
  const insert = db.sql.prepare(
    "INSERT INTO as_todos(id,member,title,details,status,priority,due_at,source,source_ref,task_id,created_at,updated_at,done_at,revision) VALUES(?,?,'t','','open','normal',NULL,'manual','',NULL,?,?,NULL,1)",
  );
  for (let i = 0; i < 500; i++) insert.run('t' + i, people.associate.email, now, now);
  assert.equal((await create({ title: 'One more' })).status, 409);
  assert.equal((await a('manager', 'todo.create', { todo: { title: 'Fine for others' } })).status, 200);
});

test('reminders: future times only, snooze range, revisions and privacy', async () => {
  const { send } = await firm();
  const a = as(send);
  const ok = okAs(send);
  const soon = Date.now() + HOUR;
  assert.match(
    (await a('associate', 'reminder.create', { reminder: { title: 'Late', dueAt: Date.now() - 5 * 60000 } }))
      .error,
    /future/,
  );
  // Up to a minute in the past is allowed for clock skew.
  assert.equal(
    (await a('associate', 'reminder.create', { reminder: { title: 'Now', dueAt: Date.now() - 30000 } }))
      .status,
    200,
  );
  assert.equal(
    (await a('associate', 'reminder.create', { reminder: { title: 'x', dueAt: soon, repeat: 'hourly' } }))
      .status,
    400,
  );
  const r = await ok('associate', 'reminder.create', {
    reminder: { title: 'File Form 15CA', dueAt: soon, repeat: 'monthly' },
  });
  assert.equal(r.status, 'active');
  assert.equal(r.repeat, 'monthly');
  assert.equal((await a('admin', 'reminder.snooze', { id: r.id, minutes: 10, baseRevision: 1 })).status, 404);
  assert.equal(
    (await a('associate', 'reminder.snooze', { id: r.id, minutes: 4, baseRevision: 1 })).status,
    400,
  );
  assert.equal(
    (await a('associate', 'reminder.snooze', { id: r.id, minutes: 10081, baseRevision: 1 })).status,
    400,
  );
  const before = Date.now();
  const snoozed = await ok('associate', 'reminder.snooze', { id: r.id, minutes: 30, baseRevision: 1 });
  assert.ok(snoozed.dueAt >= before + 30 * 60000 && snoozed.dueAt <= Date.now() + 30 * 60000);
  assert.equal(snoozed.revision, 2);
  assert.equal(
    (await a('associate', 'reminder.snooze', { id: r.id, minutes: 30, baseRevision: 1 })).status,
    409,
  );
  const paused = await ok('associate', 'reminder.update', {
    id: r.id,
    reminder: { title: 'File Form 15CA', dueAt: snoozed.dueAt, repeat: 'monthly', status: 'paused' },
    baseRevision: 2,
  });
  assert.equal(paused.status, 'paused');
  assert.equal((await ok('manager', 'reminders.list', {})).length, 0);
  assert.equal((await ok('associate', 'reminders.list', {})).length, 2);
  assert.equal((await a('manager', 'reminder.delete', { id: r.id })).status, 404);
  assert.equal(await ok('associate', 'reminder.delete', { id: r.id }), true);
});

test('memory is private, and style notes reach only the owner', async () => {
  const { send, db } = await firm();
  const a = as(send);
  const ok = okAs(send);
  const m = await ok('partner', 'memory.save', {
    memory: { category: 'style', title: 'Sign-off', content: 'Close with "Warm regards, Pia".' },
  });
  await ok('partner', 'memory.save', {
    memory: { category: 'client', title: 'Vista', content: 'Prefers calls' },
  });
  assert.equal((await ok('partner', 'memory.list', {})).length, 2);
  assert.equal((await ok('admin', 'memory.list', {})).length, 0);
  assert.equal(
    (await a('admin', 'memory.save', { id: m.id, memory: { category: 'style', title: 'x', content: 'y' } }))
      .status,
    404,
  );
  assert.equal((await a('admin', 'memory.delete', { id: m.id })).status, 404);
  const edited = await ok('partner', 'memory.save', {
    id: m.id,
    memory: { category: 'style', title: 'Sign-off', content: 'Close with "Regards, Pia".' },
  });
  assert.equal(edited.id, m.id);
  const ctx = (email) => ({ db, member: { email } });
  assert.deepEqual(await styleNotes(ctx(people.partner.email)), ['Sign-off: Close with "Regards, Pia".']);
  assert.deepEqual(await styleNotes(ctx(people.admin.email)), []);
});

test('a to-do moves onto a mandate as a Workflow task once, with the task rules', async () => {
  const { send, ok: wfOk, open, walled } = await firm();
  const a = as(send);
  const ok = okAs(send);
  const todo = await ok('associate', 'todo.create', {
    todo: { title: 'Review the disclosure letter', details: 'Schedule 3', priority: 'normal', dueAt: null },
  });
  // A mandate behind a wall the caller is not inside is not found.
  const other = await ok('article', 'todo.create', { todo: { title: 'Mine' } });
  assert.equal(
    (await a('article', 'todo.toTask', { id: other.id, matterId: walled.id, assignee: null, dueDate: null }))
      .status,
    404,
  );
  assert.equal(
    (
      await a('associate', 'todo.toTask', {
        id: todo.id,
        matterId: open.id,
        assignee: null,
        dueDate: '31-12-2026',
      })
    ).status,
    400,
  );
  const r = await ok('associate', 'todo.toTask', {
    id: todo.id,
    matterId: open.id,
    assignee: people.associate.email,
    dueDate: '2026-12-31',
  });
  assert.equal(r.todo.status, 'done');
  assert.equal(r.todo.taskId, r.taskId);
  const snap = await wfOk('associate', 'snapshot');
  const task = snap.tasks.find((t) => t.id === r.taskId);
  assert.equal(task.title, 'Review the disclosure letter');
  assert.equal(task.notes, 'Schedule 3');
  assert.equal(
    (await a('associate', 'todo.toTask', { id: todo.id, matterId: open.id, assignee: null, dueDate: null }))
      .status,
    409,
  );
  const trail = await send('admin', 'core', 'activity.list', {});
  assert.ok(trail.value.some((e) => /from a to-do/.test(e.summary)));
});

test('settings are validated and private', async () => {
  const { send } = await firm();
  const a = as(send);
  const ok = okAs(send);
  const initial = await ok('manager', 'settings.get', {});
  assert.equal(initial.settings.briefEnabled, true);
  assert.equal(initial.whatsapp.available, false);
  assert.equal(initial.whatsapp.linked, false);
  const alerts = { reminders: true, brief: false, urgentMail: true };
  assert.equal(
    (await a('manager', 'settings.save', { settings: { briefEnabled: true, briefTime: '25:00', alerts } }))
      .status,
    400,
  );
  const saved = await ok('manager', 'settings.save', {
    settings: { briefEnabled: false, briefTime: '07:45', alerts },
  });
  assert.equal(saved.briefTime, '07:45');
  assert.equal(saved.whatsapp.alerts.brief, false);
  assert.equal((await ok('associate', 'settings.get', {})).settings.briefTime, '08:30');
  assert.equal((await a('manager', 'whatsapp.link', {})).status, 409);
});
