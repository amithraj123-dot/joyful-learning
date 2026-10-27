// Meetings and the week (read only, from the cached Outlook calendar), the meeting prep pack and its
// cached AI briefing, the brief's new sections and Patterns, and the follow-up and overdue alerts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { saveNote } from '../lib/cloud-store.ts';
import { emptyDetails } from '../lib/note-details.ts';
import { getMember } from '../core/server/members.ts';
import { assistantServer } from '../modules/assistant/server/index.ts';
import { buildBrief, followUpLines, patternLines } from '../modules/assistant/server/brief.ts';
import { memberContext } from '../modules/assistant/server/context.ts';
import { dayHealth, subjectWords, tidySummary } from '../modules/assistant/server/meetings.ts';
import { runTool } from '../modules/assistant/server/tools.ts';
import { mailFirm } from './fixtures/mail-world.mjs';
import { firm, people } from './fixtures/workflow-firm.mjs';

const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const IST = 330 * MIN;
const GRANTED = 'Mail.ReadWrite Mail.Send User.Read Calendars.Read openid email profile';
const DAY0 = Date.parse('2026-10-27T00:00:00+05:30'); // a Tuesday
const NOW = DAY0 + 10 * HOUR;
const istString = (ms) => new Date(ms + IST).toISOString().slice(0, 19) + '.0000000';
const who = (name, address) => ({ emailAddress: { name, address } });
const event = (id, subject, startH, endH, over = {}) => ({
  id,
  subject,
  start: { dateTime: istString(DAY0 + startH * HOUR), timeZone: 'India Standard Time' },
  end: { dateTime: istString(DAY0 + endH * HOUR), timeZone: 'India Standard Time' },
  isAllDay: false,
  location: { displayName: '' },
  onlineMeeting: null,
  organizer: who('Ananya Rao', 'ananya.rao@northwind-holdings.example'),
  attendees: [
    { emailAddress: { name: 'Amith Rao', address: 'amith@aeka.example' }, type: 'required' },
    { emailAddress: { name: 'Pia Nair', address: 'pia@aeka.example' }, type: 'required' },
    {
      emailAddress: { name: 'Vikram Desai', address: 'vikram.desai@meridian-counsel.example' },
      type: 'optional',
    },
  ],
  isOrganizer: false,
  responseStatus: { response: 'accepted' },
  showAs: 'busy',
  isCancelled: false,
  webLink: 'https://outlook.office.com/calendar/item/' + id,
  ...over,
});
const events = [
  event('e1', 'Kestrel SPA negotiation', 11, 12, { onlineMeeting: { joinUrl: 'https://teams.example/j/1' } }),
  event('e2', 'Partners meeting', 11.5, 12.5, {
    organizer: who('Pia Nair', 'pia@aeka.example'),
    location: { displayName: 'Board room' },
  }),
  event('e3', 'Lunch with banker', 13, 14, { responseStatus: { response: 'declined' } }),
  event('e4', 'Falcon tax call', 14, 15),
  event('e5', 'Diwali holiday', 0, 24, { isAllDay: true, showAs: 'free' }),
  event('e6', 'Kite structuring', 24 + 10, 24 + 11), // tomorrow
  event('e7', 'Cancelled review', 15, 16, { isCancelled: true }),
];

async function setup() {
  const f = await mailFirm({ withMail: false });
  f.w.scope = GRANTED;
  f.w.box(people.admin.email).events.push(...events);
  await f.connect('admin');
  await f.tick('admin', NOW);
  const member = await getMember(f.db, people.admin.email);
  const sys = (now = NOW) => ({ db: f.db, env: f.options.env, fetch: f.w.fetcher, now });
  // As in a signed-in request (Scribe notes need the sign-in id).
  const ctx = (now = NOW) => ({ ...memberContext(sys(now), member), user: people.admin });
  return { ...f, member, sys, ctx };
}

const ev = (s, e, over = {}) => ({
  id: `${s}-${e}`,
  subject: `${s}`,
  start: DAY0 + s * HOUR,
  end: DAY0 + e * HOUR,
  allDay: false,
  cancelled: false,
  response: 'accepted',
  showAs: 'busy',
  ...over,
});

test('day health follows the published formula, counting only busy timed meetings in working hours', () => {
  const empty = dayHealth([], DAY0);
  assert.deepEqual(empty, {
    date: '2026-10-27',
    meetings: 0,
    meetingMinutes: 0,
    focusMinutes: 570,
    longestFocus: 570,
    clashes: 0,
    backToBack: 0,
    score: 100,
    label: 'Light',
  });
  // 9:30 to 13:30 four back-to-back hours, a clash at 15:00, free and declined ones ignored.
  const day = dayHealth(
    [
      ev(9.5, 10.5),
      ev(10.5, 11.5),
      ev(11.5, 12.5),
      ev(12.5, 13.5),
      ev(15, 16),
      ev(15.5, 16.5),
      ev(17, 18, { showAs: 'free' }),
      ev(18, 19, { response: 'declined' }),
      ev(0, 24, { allDay: true }),
      ev(7, 8), // before working hours
    ],
    DAY0,
  );
  assert.equal(day.meetings, 6);
  assert.equal(day.meetingMinutes, 4 * 60 + 90);
  assert.equal(day.clashes, 1);
  assert.equal(day.backToBack, 3);
  // Free: 13:30 to 15:00 (90) and 16:30 to 19:00 (150).
  assert.equal(day.focusMinutes, 240);
  assert.equal(day.longestFocus, 150);
  // 100 - 12 x 2.5 - 15 - 12 + 10 x 150 / 180 = 51.33
  assert.equal(day.score, 51);
  assert.equal(day.label, 'Heavy');
  const packed = dayHealth([ev(9.5, 19), ev(10, 11), ev(12, 13), ev(14, 15)], DAY0);
  assert.equal(packed.focusMinutes, 0);
  assert.equal(packed.label, 'Overloaded');
  assert.equal(dayHealth([ev(10, 12), ev(14, 15)], DAY0).label, 'Light');
  // A short meeting inside a long one does not hide the next one starting as the long one ends.
  assert.equal(dayHealth([ev(10, 12), ev(10.5, 11), ev(12, 13)], DAY0).backToBack, 1);
});

test('meetings.upcoming and schedule.week read the cached calendar and explain an empty one', async () => {
  const f = await setup();
  const { calendar, events: list } = await assistantServer.actions['meetings.upcoming'].handler(f.ctx(), {});
  assert.equal(calendar, 'ready');
  assert.deepEqual(
    list.map((e) => [e.subject, e.clash, e.place]),
    [
      ['Diwali holiday', false, ''],
      ['Kestrel SPA negotiation', true, 'Online'],
      ['Partners meeting', true, 'Board room'],
      ['Falcon tax call', false, ''],
      ['Kite structuring', false, ''],
    ],
  );
  const today = await assistantServer.actions['meetings.upcoming'].handler(f.ctx(), { days: 1 });
  assert.ok(!today.events.some((e) => e.subject === 'Kite structuring'));
  await assert.rejects(
    async () => assistantServer.actions['meetings.upcoming'].handler(f.ctx(), { days: 9 }),
    /1 to 7/,
  );
  const week = await assistantServer.actions['schedule.week'].handler(f.ctx(), {});
  assert.equal(week.calendar, 'ready');
  assert.equal(week.days.length, 7);
  assert.equal(week.days[0].date, '2026-10-27');
  assert.equal(week.days[0].meetings, 3);
  assert.equal(week.days[0].clashes, 1);
  assert.equal(week.days[0].meetingMinutes, 150);
  assert.equal(week.days[1].meetings, 1);
  assert.equal(week.days[6].date, '2026-11-02');
  // Without Outlook the days are empty and the status says why.
  const { send } = await firm();
  const r = await send('associate', 'assistant', 'schedule.week', {});
  assert.deepEqual(r.value, { days: [], calendar: 'not_connected' });
  const up = await send('associate', 'assistant', 'meetings.upcoming', {});
  assert.deepEqual(up.value, { calendar: 'not_connected', events: [] });
});

test('meetings.prep assembles a pack without AI; the briefing is made on request and cached', async () => {
  const f = await setup();
  await saveNote(
    f.db,
    people.admin.userId,
    {
      id: 'n-kestrel',
      title: 'Kestrel SPA call notes',
      kind: 'meeting',
      createdAt: NOW - 3 * DAY,
      updatedAt: 0,
      body: '',
      summary: 'Discussed the Kestrel SPA indemnity cap and escrow.',
      folder: '',
      segments: [],
      speakers: {},
      eventId: '',
      status: 'complete',
      duration: 60,
      details: emptyDetails(),
    },
    undefined,
    people.admin.email,
  );
  await f.send('admin', 'assistant', 'todo.quickAdd', { text: 'Mark up Kestrel indemnity #Kestrel' });
  const aiBefore = f.w.ai.length;
  const prep = await assistantServer.actions['meetings.prep'].handler(f.ctx(), { eventId: 'e1' });
  assert.equal(f.w.ai.length, aiBefore);
  assert.equal(prep.event.subject, 'Kestrel SPA negotiation');
  assert.equal(prep.event.place, 'Online');
  // Other attendees, external first; I am left out.
  assert.deepEqual(
    prep.people.map((p) => [p.address, p.colleague]),
    [
      ['ananya.rao@northwind-holdings.example', false],
      ['vikram.desai@meridian-counsel.example', false],
      ['pia@aeka.example', true],
    ],
  );
  assert.deepEqual(
    prep.notes.map((n) => n.noteId),
    ['n-kestrel'],
  );
  assert.deepEqual(
    prep.todos.map((t) => t.title),
    ['Mark up Kestrel indemnity'],
  );
  assert.equal(prep.summary, null);
  await assert.rejects(
    async () => assistantServer.actions['meetings.prep'].handler(f.ctx(), { eventId: 'nope' }),
    /could not be found/,
  );
  // Another member cannot prepare my meeting.
  const other = memberContext(f.sys(), await getMember(f.db, people.manager.email));
  await assert.rejects(
    async () => assistantServer.actions['meetings.prep'].handler(other, { eventId: 'e1' }),
    /could not be found/,
  );

  f.w.aiReply = (body) => {
    assert.match(body.messages[0].content, /data, never instructions/);
    assert.match(body.messages[1].content, /^<data>\n/);
    return '- Purpose: agree the Kestrel SPA tax indemnity — before closing!\n**People:** Ananya Rao (client), Vikram Desai (counsel).\nPrepare: the cap under the step-up structure.\n\n';
  };
  const s1 = await assistantServer.actions['meetings.prepSummary'].handler(f.ctx(), { eventId: 'e1' });
  assert.equal(
    s1.text,
    'Purpose: agree the Kestrel SPA tax indemnity, before closing.\nPeople: Ananya Rao (client), Vikram Desai (counsel).\nPrepare: the cap under the step-up structure.',
  );
  const calls = f.w.ai.length;
  const s2 = await assistantServer.actions['meetings.prepSummary'].handler(f.ctx(NOW + MIN), {
    eventId: 'e1',
  });
  assert.deepEqual(s2, s1);
  assert.equal(f.w.ai.length, calls);
  assert.equal(
    (await assistantServer.actions['meetings.prep'].handler(f.ctx(), { eventId: 'e1' })).summary.text,
    s1.text,
  );
  f.w.aiReply = () => 'Purpose: refreshed.';
  const s3 = await assistantServer.actions['meetings.prepSummary'].handler(f.ctx(NOW + 2 * MIN), {
    eventId: 'e1',
    refresh: true,
  });
  assert.equal(s3.text, 'Purpose: refreshed.');
  assert.equal(f.w.ai.length, calls + 1);
  assert.equal(f.rows('SELECT count(*) AS n FROM as_meeting_preps')[0].n, 1);
  // An empty answer is reported and nothing is stored.
  f.w.aiReply = () => '   ';
  await assert.rejects(
    async () =>
      assistantServer.actions['meetings.prepSummary'].handler(f.ctx(), { eventId: 'e4', refresh: true }),
    /empty briefing/,
  );
  assert.equal(f.rows('SELECT count(*) AS n FROM as_meeting_preps')[0].n, 1);
});

test('prep helpers: subject words for note search, and plain house-style briefing lines', () => {
  assert.deepEqual(subjectWords('RE: Falcon tax call with the buyer'), ['falcon', 'tax', 'buyer']);
  assert.deepEqual(subjectWords('Weekly sync'), []);
  assert.equal(
    tidySummary('1. Risks: timing – tight!\n* Prepare: note'),
    'Risks: timing, tight.\nPrepare: note',
  );
  assert.equal(
    tidySummary(Array.from({ length: 12 }, (_, i) => `Line ${i}`).join('\n')).split('\n').length,
    8,
  );
});

test('chat tools: quick_add_todo, meeting_prep and follow_ups', async () => {
  const f = await setup();
  const env = { ctx: f.ctx(), channel: 'web' };
  const qa = await runTool(
    env,
    'quick_add_todo',
    JSON.stringify({ text: 'Send Rahul the note tomorrow 4pm #Falcon' }),
  );
  assert.equal(qa.note.ok, true);
  assert.match(
    qa.note.summary,
    /^Created to-do: Send Rahul the note, due 28 Oct 2026, 4:00 pm, list Falcon$/,
  );
  assert.match(JSON.parse(qa.content).result.understood, /^Read as "Send Rahul the note"/);
  const next = await runTool(env, 'meeting_prep', JSON.stringify({ when: 'next' }));
  assert.equal(next.note.ok, true);
  assert.equal(JSON.parse(next.content).result.meeting.subject, 'Kestrel SPA negotiation');
  const byWords = await runTool(env, 'meeting_prep', JSON.stringify({ when: 'falcon tax' }));
  assert.equal(JSON.parse(byWords.content).result.meeting.subject, 'Falcon tax call');
  const byTime = await runTool(env, 'meeting_prep', JSON.stringify({ when: '2026-10-27T11:40:00+05:30' }));
  assert.equal(JSON.parse(byTime.content).result.meeting.subject, 'Partners meeting');
  const none = await runTool(env, 'meeting_prep', JSON.stringify({ when: 'board offsite' }));
  assert.equal(none.note.ok, false);
  assert.match(none.note.summary, /No meeting matched/);
  const fu = await runTool(env, 'follow_ups', JSON.stringify({ kind: 'waiting' }));
  assert.equal(fu.note.ok, true);
  assert.ok(Array.isArray(JSON.parse(fu.content).result.items));
  assert.equal((await runTool(env, 'follow_ups', JSON.stringify({ kind: 'all' }))).note.ok, false);
  // Without Outlook, a clear refusal.
  const plain = memberContext(f.sys(), await getMember(f.db, people.manager.email));
  const off = await runTool({ ctx: plain, channel: 'web' }, 'follow_ups', '{}');
  assert.match(off.note.summary, /Outlook is not connected/);
});

const follow = (over = {}) => ({
  conversationId: 'c1',
  kind: 'chasing',
  subject: 'Falcon SPA',
  counterpart: { name: 'Rahul Mehta', address: 'rahul@vista-earth.example' },
  since: NOW - 3 * DAY,
  ageDays: 3,
  level: 3,
  count: 3,
  mailId: 'm1',
  matterLabel: '',
  snoozedUntil: null,
  ...over,
});

test('Patterns are counted observations, and the follow-up lines say who and how long', () => {
  const items = [
    follow(),
    follow({
      conversationId: 'c2',
      counterpart: { name: 'Ananya Rao', address: 'ananya@x.example' },
      count: 2,
      level: 2,
      ageDays: 1,
    }),
    follow({
      conversationId: 'c3',
      kind: 'waiting',
      subject: 'Kite term sheet',
      counterpart: { name: '', address: 'cfo@kite.example' },
      ageDays: 11,
      level: 3,
      count: 2,
    }),
  ];
  const health = dayHealth([ev(10, 12), ev(12, 13), ev(15, 17)], DAY0);
  const lines = patternLines({ followUps: items, health, commitmentsDue: 4 }).map((l) => l.text);
  assert.deepEqual(lines, [
    '1 person has been waiting on you for more than 2 days.',
    'You have 5 hours of meetings and 4 hours of focus time today.',
    'Rahul Mehta has followed up 3 times on "Falcon SPA".',
    '1 email you sent has had no reply for 10 days or more.',
    '4 commitments you made in email are due by the end of this week.',
  ]);
  assert.deepEqual(patternLines({ followUps: [], health: dayHealth([], DAY0), commitmentsDue: 0 }), []);
  assert.deepEqual(
    followUpLines(items).map((l) => l.text),
    [
      'Rahul Mehta is waiting for your reply on "Falcon SPA" (3 messages, 3 days)',
      'Ananya Rao is waiting for your reply on "Falcon SPA" (2 messages, 1 day)',
      'You are waiting on cfo@kite.example for "Kite term sheet" (11 days, 2 emails unanswered)',
    ],
  );
});

test('the brief leads with critical to-dos, shows the day health and Patterns, and keeps sections short', async () => {
  const f = await setup();
  const ctx = f.ctx();
  const insert = f.db.sql.prepare(
    "INSERT INTO as_todos(id,member,title,details,status,priority,due_at,source,source_ref,task_id,created_at,updated_at,done_at,revision) VALUES(?,?,?,'','open','normal',?,?,?,NULL,?,?,NULL,1)",
  );
  const me = people.admin.email;
  for (let i = 0; i < 7; i++)
    insert.run('c' + i, me, 'Late ' + i, NOW - (4 + i) * DAY, 'manual', '', NOW - 20 * DAY, NOW);
  insert.run('p1', me, 'Send the note', NOW + 2 * DAY, 'commitment', 'sent-1:0', NOW, NOW);
  insert.run('s1', me, 'Someday idea', null, 'manual', '', NOW - 9 * DAY, NOW);
  const brief = await buildBrief(ctx);
  assert.equal(brief.sections[0].title, 'Overdue 3 days or more');
  assert.equal(brief.sections[0].lines.length, 5);
  assert.equal(brief.sections[0].lines[4].text, 'and 3 more');
  const calendar = brief.sections.find((s) => s.title === 'Your calendar today');
  assert.match(calendar.lines[0].text, /^Day health: (Light|Balanced|Heavy|Overloaded) \(\d+ of 100\)\.$/);
  // Critical ones are not repeated under due today.
  assert.ok(
    !(brief.sections.find((s) => s.title === 'Due today and overdue')?.lines ?? []).some((l) =>
      /Late/.test(l.text),
    ),
  );
  assert.deepEqual(
    brief.sections
      .find((s) => s.title === 'Open for more than a week without a date')
      .lines.map((l) => l.text),
    ['Someday idea (added 18 Oct)'],
  );
  const patterns = brief.sections.find((s) => s.title === 'Patterns').lines.map((l) => l.text);
  assert.ok(
    patterns.includes('You have 2.5 hours of meetings and 7 hours of focus time today, with 1 clash.'),
  );
  assert.ok(patterns.includes('1 commitment you made in email is due by the end of this week.'));
  for (const s of brief.sections) for (const l of s.lines) assert.doesNotMatch(l.text, /[–—!]/);
});

test('critical to-dos and long-unanswered emails notify in the app once each, never on WhatsApp', async () => {
  const f = await setup();
  const insert = f.db.sql.prepare(
    "INSERT INTO as_todos(id,member,title,details,status,priority,due_at,source,source_ref,task_id,created_at,updated_at,done_at,revision) VALUES(?,?,?,'',?,'normal',?,'manual','',?,?,?,NULL,1)",
  );
  const me = people.admin.email;
  insert.run('late', me, 'File the return', 'open', NOW - 4 * DAY, null, NOW - 9 * DAY, NOW);
  insert.run('recent', me, 'Recent', 'open', NOW - 2 * DAY, null, NOW - 9 * DAY, NOW);
  insert.run('closed', me, 'Closed', 'done', NOW - 9 * DAY, null, NOW - 9 * DAY, NOW);
  insert.run('dismissed', me, 'Dismissed', 'open', NOW - 9 * DAY, 'dismissed:1', NOW - 9 * DAY, NOW);
  const tick = (now) => assistantServer.tick(f.sys(now), { member: f.member });
  const notices = () =>
    f
      .rows(
        "SELECT kind, title, link FROM org_notifications WHERE recipient = ? AND kind IN ('todo.critical','followup')",
        me,
      )
      .map((r) => ({ ...r }));
  await tick(NOW);
  assert.deepEqual(notices(), [
    { kind: 'todo.critical', title: 'Overdue since 23 Oct: File the return', link: 'assistant/todos#late' },
  ]);
  // Checked again after 30 minutes; still one notice.
  await tick(NOW + 31 * MIN);
  await tick(NOW + 2 * HOUR);
  assert.equal(notices().length, 1);
  // These kinds are never queued for WhatsApp.
  assert.equal(f.rows('SELECT count(*) AS n FROM as_outbox')[0].n, 0);
});

test('a sent email unanswered for 10 days shows in the brief and alerts once per conversation and level', async () => {
  const f = await mailFirm({ withMail: false });
  const now = Date.now();
  f.w.box(people.admin.email).sent.push({
    id: 'g-sent-kite',
    subject: 'Kite term sheet',
    from: who('Amith Rao', 'amith@aeka.example'),
    to: [who('Kite CFO', 'cfo@kite.example')],
    hoursAgo: 11 * 24,
    conversationId: 'c-kite',
    body: 'Could you confirm the revised valuation by Friday?',
  });
  await f.connect('admin');
  await f.tick('admin', now);
  const member = await getMember(f.db, people.admin.email);
  const sys = { db: f.db, env: f.options.env, fetch: f.w.fetcher, now };
  const brief = await buildBrief(memberContext(sys, member));
  const section = brief.sections.find((s) => s.title === 'Waiting and chasing');
  assert.ok(section, 'Waiting and chasing section');
  assert.match(section.lines[0].text, /^You are waiting on Kite CFO for "Kite term sheet" \(1[01] days\)$/);
  assert.ok(
    brief.sections.find((s) => s.title === 'Patterns').lines.some((l) => /no reply for 10 days/.test(l.text)),
  );
  await assistantServer.tick(sys, { member });
  await assistantServer.tick({ ...sys, now: now + HOUR }, { member });
  const alerts = f.rows("SELECT title, link, dedupe_key FROM org_notifications WHERE kind = 'followup'");
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].title, /^No reply for 1[01] days: Kite term sheet$/);
  assert.equal(alerts[0].link, 'mail/followups');
  assert.equal(alerts[0].dedupe_key, 'followup:c-kite:3');
});
