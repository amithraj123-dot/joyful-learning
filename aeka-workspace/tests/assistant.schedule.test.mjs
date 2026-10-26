import test from 'node:test';
import assert from 'node:assert/strict';
import { getMember } from '../core/server/members.ts';
import { assistantServer } from '../modules/assistant/server/index.ts';
import { advance, nextOccurrence } from '../modules/assistant/server/recurrence.ts';
import { todayIST } from '../modules/workflow/shared/types.ts';
import { firm, people, taskInput } from './fixtures/workflow-firm.mjs';

const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ist = (s) => Date.parse(s + '+05:30'); // India time, e.g. '2026-10-30T09:00:00'
const iso = (ms) => new Date(ms + 330 * MIN).toISOString().slice(0, 16); // back to India time

test('recurrence follows India time: weekdays, month ends and leap years', () => {
  // Friday 2 am India time is still Thursday in UTC; the next weekday is Monday 2 am India time.
  assert.equal(iso(nextOccurrence(ist('2026-10-30T02:00:00'), 'weekdays')), '2026-11-02T02:00');
  assert.equal(iso(nextOccurrence(ist('2026-10-29T02:00:00'), 'weekdays')), '2026-10-30T02:00');
  assert.equal(iso(nextOccurrence(ist('2026-10-31T23:30:00'), 'daily')), '2026-11-01T23:30');
  assert.equal(iso(nextOccurrence(ist('2026-10-26T09:00:00'), 'weekly')), '2026-11-02T09:00');
  assert.equal(nextOccurrence(ist('2026-10-26T09:00:00'), 'once'), null);
  // 00:30 on the 1st in India is the previous day in UTC.
  assert.equal(iso(nextOccurrence(ist('2026-01-01T00:30:00'), 'monthly')), '2026-02-01T00:30');
  // The 31st: the last day of shorter months, then back to the 31st.
  let due = ist('2027-01-31T09:00:00');
  let prev = null;
  const seen = [];
  for (let i = 0; i < 5; i++) {
    const next = nextOccurrence(due, 'monthly', prev);
    prev = due;
    due = next;
    seen.push(iso(due).slice(0, 10));
  }
  assert.deepEqual(seen, ['2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31', '2027-06-30']);
  assert.equal(iso(nextOccurrence(ist('2028-01-30T09:00:00'), 'monthly')).slice(0, 10), '2028-02-29');
  assert.equal(
    iso(nextOccurrence(ist('2028-02-29T09:00:00'), 'monthly', ist('2028-01-30T09:00:00'))).slice(0, 10),
    '2028-03-30',
  );
  assert.equal(iso(nextOccurrence(ist('2026-12-15T09:00:00'), 'monthly')).slice(0, 10), '2027-01-15');
  // After downtime: the latest missed occurrence and the next future one.
  const a = advance(ist('2026-10-01T09:00:00'), 'daily', ist('2026-10-26T10:00:00'));
  assert.equal(iso(a.last), '2026-10-26T09:00');
  assert.equal(iso(a.next), '2026-10-27T09:00');
  const w = advance(ist('2026-10-01T09:00:00'), 'weekdays', ist('2026-10-24T10:00:00')); // a Saturday
  assert.equal(iso(w.last), '2026-10-23T09:00');
  assert.equal(iso(w.next), '2026-10-26T09:00');
});

async function setup() {
  const f = await firm();
  const member = await getMember(f.db, people.associate.email);
  const tick = (now) =>
    assistantServer.tick({ db: f.db, env: {}, fetch: f.options.fetcher, now }, { member });
  const reminder = (id, dueAt, repeat = 'once') =>
    f.db.sql
      .prepare(
        "INSERT INTO as_reminders(id,member,title,due_at,repeat,status,last_fired_at,created_at,updated_at,revision) VALUES(?,?,?,?,?,'active',NULL,0,0,1)",
      )
      .run(id, member.email, 'Reminder ' + id, dueAt, repeat);
  const notices = (kind) =>
    f.db.sql
      .prepare('SELECT * FROM org_notifications WHERE recipient = ? AND kind = ? ORDER BY created_at, rowid')
      .all(member.email, kind);
  const row = (id) => f.db.sql.prepare('SELECT * FROM as_reminders WHERE id = ?').get(id);
  return { ...f, member, tick, reminder, notices, row };
}

test('due reminders notify once per occurrence and then advance or finish', async () => {
  const { tick, reminder, notices, row, send } = await setup();
  const due = ist('2026-10-27T15:00:00');
  reminder('once', due);
  reminder('daily', due, 'daily');
  await tick(due - MIN);
  assert.equal(notices('reminder').length, 0);
  await tick(due + MIN);
  const n = notices('reminder');
  assert.equal(n.length, 2);
  assert.match(n[0].body, /^Due 27 Oct 2026, 3:00 pm\./);
  assert.equal(n[0].link.startsWith('assistant/todos#'), true);
  assert.equal(row('once').status, 'done');
  assert.equal(row('daily').status, 'active');
  assert.equal(iso(row('daily').due_at), '2026-10-28T15:00');
  assert.match(n.find((x) => x.title === 'Reminder daily').body, /Next: 28 Oct 2026, 3:00 pm/);
  await tick(due + 2 * MIN);
  assert.equal(notices('reminder').length, 2);
  // Notices are the member's own.
  assert.equal((await send('manager', 'core', 'notifications.list', {})).value.items.length, 0);
});

test('after downtime one catch-up notice fires, then the reminder moves to its next future time', async () => {
  const { tick, reminder, notices, row } = await setup();
  const due = ist('2026-10-20T09:00:00'); // a Tuesday
  reminder('standup', due, 'weekdays');
  const back = ist('2026-10-26T11:00:00'); // the next Monday
  await tick(back);
  const n = notices('reminder');
  assert.equal(n.length, 1);
  assert.match(n[0].body, /shown late/);
  assert.match(n[0].body, /later occurrences were skipped/);
  assert.equal(iso(row('standup').due_at), '2026-10-27T09:00');
  assert.equal(iso(row('standup').last_fired_at), '2026-10-26T09:00');
  await tick(back + MIN);
  assert.equal(notices('reminder').length, 1);
});

test('overlapping ticks never duplicate a reminder', async () => {
  const { tick, reminder, notices, row } = await setup();
  const due = ist('2026-10-27T15:00:00');
  for (let i = 0; i < 5; i++) reminder('r' + i, due + i, i % 2 ? 'daily' : 'once');
  await Promise.all([tick(due + MIN), tick(due + MIN), tick(due + 2 * MIN)]);
  assert.equal(notices('reminder').length, 5);
  for (let i = 0; i < 5; i++) assert.equal(row('r' + i).revision, 2);
});

test('the morning brief is posted once a day at or after the brief time', async () => {
  const { tick, notices, send } = await setup();
  await send('associate', 'assistant', 'settings.save', {
    settings: {
      briefEnabled: true,
      briefTime: '08:00',
      alerts: { reminders: true, brief: true, urgentMail: true },
    },
  });
  await tick(ist('2026-10-27T07:59:00'));
  assert.equal(notices('brief').length, 0);
  await Promise.all([tick(ist('2026-10-27T08:01:00')), tick(ist('2026-10-27T08:01:00'))]);
  await tick(ist('2026-10-27T13:00:00'));
  const n = notices('brief');
  assert.equal(n.length, 1);
  assert.equal(n[0].title, 'Your brief for 27 Oct');
  assert.equal(n[0].link, 'assistant/today');
  await tick(ist('2026-10-28T08:05:00'));
  assert.equal(notices('brief').length, 2);
  assert.equal(notices('brief')[1].title, 'Your brief for 28 Oct');
  // Switched off: nothing more.
  await send('associate', 'assistant', 'settings.save', {
    settings: {
      briefEnabled: false,
      briefTime: '08:00',
      alerts: { reminders: true, brief: true, urgentMail: true },
    },
  });
  await tick(ist('2026-10-29T09:00:00'));
  assert.equal(notices('brief').length, 2);
});

test('brief.get lists overdue to-dos, tasks due, deadlines and reminders, and leaves out empty sections', async () => {
  const { send, ok: wfOk, open } = await setup();
  const a = (who, action, payload) => send(who, 'assistant', action, payload);
  const empty = await a('associate', 'brief.get', {});
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.value.sections, []);
  const now = Date.now();
  await a('associate', 'todo.create', { todo: { title: 'Send the CP checklist', dueAt: now - 2 * DAY } });
  await a('associate', 'todo.create', { todo: { title: 'Later', dueAt: now + 3 * DAY } });
  await wfOk('associate', 'task.create', {
    task: taskInput(open.id, {
      title: 'Tax DD report',
      assignee: people.associate.email,
      dueDate: todayIST(now),
    }),
  });
  await wfOk('manager', 'milestone.create', {
    milestone: {
      matterId: open.id,
      title: 'Signing',
      kind: 'Signing',
      dueDate: todayIST(now + 3 * DAY),
      done: false,
      owner: null,
    },
  });
  const brief = (await a('associate', 'brief.get', {})).value;
  assert.equal(brief.date, todayIST(now));
  const section = (title) => brief.sections.find((s) => s.title === title);
  assert.equal(section('Needs you in mail'), undefined); // no mailbox connected
  const due = section('Due today and overdue').lines;
  assert.equal(due.length, 2);
  assert.match(due[0].text, /Send the CP checklist \(overdue since/);
  assert.match(due[1].text, /Tax DD report, Vista Earth Group: Project Falcon \(due today\)/);
  assert.equal(due[1].link, 'workflow/tasks');
  assert.match(
    section('Deadlines in the next 7 days').lines[0].text,
    /Signing, Vista Earth Group: Project Falcon/,
  );
  // Another member sees none of the associate's own items, only the firm deadline on an open mandate.
  const theirs = (await a('article', 'brief.get', {})).value;
  assert.deepEqual(
    theirs.sections.map((s) => s.title),
    ['Deadlines in the next 7 days'],
  );
});
