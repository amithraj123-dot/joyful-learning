import test from 'node:test';
import assert from 'node:assert/strict';
import { getMember } from '../core/server/members.ts';
import { buildBrief } from '../modules/assistant/server/brief.ts';
import { meetingAlerts } from '../modules/assistant/server/calendar.ts';
import { memberContext } from '../modules/assistant/server/context.ts';
import { runTool } from '../modules/assistant/server/tools.ts';
import { clashes, freeSlots } from '../modules/mail/server/calendar.ts';
import { GraphSession } from '../modules/mail/server/graph.ts';
import { loadAccount } from '../modules/mail/server/store.ts';
import { mailFirm } from './fixtures/mail-world.mjs';
import { people } from './fixtures/workflow-firm.mjs';

const MIN = 60000;
const HOUR = 60 * MIN;
const IST = 330 * MIN;
const GRANTED = 'Mail.ReadWrite Mail.Send User.Read Calendars.Read openid email profile';
// 10:00 India time on a fixed weekday, as "now" for the tests.
const DAY0 = Date.parse('2026-10-27T00:00:00+05:30');
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
  attendees: [{ emailAddress: { name: 'Amith Rao', address: 'amith@aeka.example' }, type: 'required' }],
  isOrganizer: false,
  responseStatus: { response: 'accepted' },
  showAs: 'busy',
  isCancelled: false,
  webLink: 'https://outlook.office.com/calendar/item/1',
  ...over,
});
const day = [
  event('e1', 'Kestrel SPA negotiation', 11, 12, { onlineMeeting: { joinUrl: 'https://teams.example/j/1' } }),
  event('e2', 'Partners meeting', 11.5, 12.5, {
    organizer: who('Pia Nair', 'pia@aeka.example'),
    location: { displayName: 'Board room' },
  }),
  event('e3', 'Lunch with banker', 13, 14, { responseStatus: { response: 'declined' } }),
  event('e4', 'Cancelled review', 15, 16, { isCancelled: true }),
  event('e5', 'Diwali holiday', 0, 24, {
    isAllDay: true,
    showAs: 'free',
    organizer: who('Amith Rao', 'amith@aeka.example'),
  }),
  event('e6', 'Falcon tax call', 10.25, 10.75, { organizer: who('Pia Nair', 'pia@aeka.example') }),
];

async function setup({ granted = true, expiresIn = 3600 } = {}) {
  const f = await mailFirm({ withMail: false });
  f.w.scope = granted ? GRANTED : '';
  f.w.expiresIn = expiresIn;
  f.w.box(people.admin.email).events.push(...day);
  await f.connect('admin');
  const member = await getMember(f.db, people.admin.email);
  const sys = (now = NOW) => ({ db: f.db, env: f.options.env, fetch: f.w.fetcher, now });
  return { ...f, member, sys, ctx: (now = NOW) => memberContext(sys(now), member) };
}

test('free time and clashes follow busy events only, within working hours', () => {
  const ev = (s, e, over = {}) => ({
    start: DAY0 + s * HOUR,
    end: DAY0 + e * HOUR,
    allDay: false,
    cancelled: false,
    response: 'accepted',
    showAs: 'busy',
    subject: `${s}`,
    ...over,
  });
  const hours = { from: 9.5 * 60, to: 19 * 60 };
  const events = [
    ev(11, 12),
    ev(11.5, 12.5),
    ev(13, 14, { response: 'declined' }),
    ev(15, 16, { showAs: 'free' }),
  ];
  const slots = freeSlots(events, DAY0, 30, hours, NOW).map((s) => [
    (s.start - DAY0) / HOUR,
    (s.end - DAY0) / HOUR,
  ]);
  assert.deepEqual(slots, [
    [10, 11],
    [12.5, 19],
  ]);
  // Gaps shorter than asked are left out; the day starts no earlier than now.
  assert.deepEqual(
    freeSlots(events, DAY0, 90, hours, DAY0 + 10.75 * HOUR).map((s) => (s.start - DAY0) / HOUR),
    [12.5],
  );
  assert.equal(clashes(events.map((e, i) => ({ ...e, id: String(i) }))).length, 1);
});

test('without calendar permission nothing is read and the member is asked to allow it', async () => {
  const f = await setup({ granted: false, expiresIn: 1 });
  await f.tick('admin', NOW);
  assert.equal((await loadAccount(f.db, people.admin.email)).calendar_status, 'needs_consent');
  assert.ok(!f.w.graphCalls().some((c) => c.url.includes('calendarView')));
  assert.equal((await f.ok('admin', 'account.get', {})).account.calendar, 'needs_consent');
  const brief = await buildBrief(f.ctx());
  assert.match(brief.sections[0].lines[0].text, /Allow calendar access/);
  const tool = await runTool({ ctx: f.ctx(), channel: 'web' }, 'calendar', '{}');
  assert.equal(tool.note.ok, false);
  assert.match(tool.note.summary, /Calendar access has not been allowed/);
  // Refreshing an older sign-in never asks Microsoft for the new permission.
  await f.tick('admin', NOW + 20 * MIN);
  const refresh = f.w.calls.find((c) => c.url.includes('/token') && String(c.body).includes('refresh_token'));
  assert.ok(refresh);
  assert.ok(!new URLSearchParams(refresh.body).get('scope').includes('Calendars.Read'));
});

test('the calendar is cached in India time, refreshed in the background and read only', async () => {
  const f = await setup();
  await f.tick('admin', NOW);
  const call = f.w.graphCalls().find((c) => c.url.includes('calendarView'));
  assert.ok(call);
  assert.match(f.w.lastPrefer || '', /India Standard Time/);
  assert.equal(f.rows('SELECT count(*) AS n FROM mail_events')[0].n, day.length);
  const account = await f.ok('admin', 'account.get', {});
  assert.equal(account.account.calendar, 'ready');
  const cached = f.rows("SELECT start_at, end_at FROM mail_events WHERE id = 'e1'")[0];
  assert.equal(cached.start_at, DAY0 + 11 * HOUR);
  // No further calendar read within 15 minutes.
  const before = f.w.graphCalls().filter((c) => c.url.includes('calendarView')).length;
  await f.tick('admin', NOW + 5 * MIN);
  assert.equal(f.w.graphCalls().filter((c) => c.url.includes('calendarView')).length, before);
  // Writing to the calendar is refused before anything is sent.
  const session = new GraphSession(f.sys(), await loadAccount(f.db, people.admin.email));
  await assert.rejects(session.request('POST', '/me/events', { subject: 'x' }), /not permitted/);
  await assert.rejects(session.request('GET', '/me/events/e1/accept'), /not permitted/);
  // A 403 later marks the calendar as needing permission again; mail is unaffected.
  f.w.calendarStatus = 403;
  await f.tick('admin', NOW + 20 * MIN);
  assert.equal((await loadAccount(f.db, people.admin.email)).calendar_status, 'needs_consent');
  assert.equal((await loadAccount(f.db, people.admin.email)).status, 'connected');
  // Disconnecting removes the cached calendar.
  await f.ok('admin', 'account.disconnect', {});
  assert.equal(f.rows('SELECT count(*) AS n FROM mail_events')[0].n, 0);
});

test('the brief lists today, flags clashes and free time, and links a known mandate', async () => {
  const f = await setup();
  await f.tick('admin', NOW);
  // The member earlier confirmed Northwind mail as Project Falcon.
  f.db.sql
    .prepare(
      "INSERT INTO mail_corrections(id,member,message_id,field,from_value,to_value,sender,domain,created_at) VALUES('c1',?,'m1','matterId','',?,'x@northwind-holdings.example','northwind-holdings.example',1)",
    )
    .run(people.admin.email, f.open.id);
  const brief = await buildBrief(f.ctx());
  const section = brief.sections.find((s) => s.title === 'Your calendar today');
  assert.ok(section);
  const text = section.lines.map((l) => l.text);
  assert.ok(text.includes('All day: Diwali holiday'));
  assert.ok(
    text.some((t) =>
      t.startsWith(
        '11:00 am to 12:00 pm: Kestrel SPA negotiation (online), Vista Earth Group: Project Falcon',
      ),
    ),
  );
  assert.ok(text.some((t) => t.startsWith('11:30 am to 12:30 pm: Partners meeting (Board room)')));
  assert.ok(!text.some((t) => /Lunch with banker|Cancelled review/.test(t)));
  assert.ok(text.some((t) => /^Clash: "Kestrel SPA negotiation" and "Partners meeting"/.test(t)));
  assert.ok(
    text.includes('Free time: 10:45 am to 11:00 am, 12:30 pm to 7:00 pm') ||
      text.some((t) => t.startsWith('Free time: 12:30 pm to 7:00 pm')),
  );
  assert.equal(section.lines.find((l) => l.text.includes('Kestrel')).link, `workflow/matters#${f.open.id}`);
  // Another member sees none of it.
  const other = memberContext(f.sys(), await getMember(f.db, people.manager.email));
  assert.ok(!(await buildBrief(other)).sections.some((s) => s.title === 'Your calendar today'));
});

test('chat tools read the calendar and find free time, and check their arguments', async () => {
  const f = await setup();
  await f.tick('admin', NOW);
  const env = { ctx: f.ctx(), channel: 'web' };
  const cal = await runTool(env, 'calendar', JSON.stringify({ date: '2026-10-27' }));
  const result = JSON.parse(cal.content).result;
  assert.equal(cal.note.ok, true);
  assert.ok(result.events.some((e) => e.subject === 'Kestrel SPA negotiation' && e.place === 'online'));
  assert.ok(!result.events.some((e) => e.subject === 'Cancelled review'));
  const free = await runTool(env, 'find_free_time', JSON.stringify({ date: '2026-10-27', minutes: 60 }));
  assert.deepEqual(JSON.parse(free.content).result.free, ['12:30 pm to 7:00 pm']);
  const bad = await runTool(env, 'find_free_time', JSON.stringify({ date: '2026-12-31', minutes: 60 }));
  assert.equal(bad.note.ok, false);
  assert.match(bad.note.summary, /yesterday to 13 days ahead/);
  const wrong = await runTool(
    env,
    'find_free_time',
    JSON.stringify({ date: '2026-10-27', minutes: 60, from: '7pm' }),
  );
  assert.equal(wrong.note.ok, false);
});

test('a meeting alert is sent once, about 10 minutes before, and never for declined meetings', async () => {
  const f = await setup();
  await f.tick('admin', NOW);
  const at = DAY0 + 10.25 * HOUR - 8 * MIN; // 8 minutes before the Falcon call
  assert.equal(await meetingAlerts(f.sys(at), f.member), 1);
  assert.equal(await meetingAlerts(f.sys(at + MIN), f.member), 0);
  const notice = f.rows("SELECT title, body FROM org_notifications WHERE kind = 'meeting'")[0];
  assert.equal(notice.title, 'In 8 minutes: Falcon tax call');
  // The declined lunch never alerts.
  assert.equal(await meetingAlerts(f.sys(DAY0 + 13 * HOUR - 5 * MIN), f.member), 0);
  // Turned off in settings: nothing.
  const s = await f.send('admin', 'assistant', 'settings.get', {});
  const { whatsapp, ...rest } = s.value.settings;
  const saved = await f.send('admin', 'assistant', 'settings.save', {
    settings: { ...rest, meetingAlerts: false, alerts: whatsapp.alerts },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.value.meetingAlerts, false);
  assert.equal(await meetingAlerts(f.sys(DAY0 + 11 * HOUR - 9 * MIN), f.member), 0);
  // A browser that does not know the setting yet keeps it as it is.
  const old = await f.send('admin', 'assistant', 'settings.save', {
    settings: {
      briefEnabled: true,
      briefTime: '08:30',
      alerts: { reminders: true, brief: true, urgentMail: true },
    },
  });
  assert.equal(old.status, 200);
  assert.equal(old.value.meetingAlerts, false);
});
