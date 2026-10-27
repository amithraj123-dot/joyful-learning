'use client';
// Today's schedule pieces: a week strip of day health (meetings against focus time) and the meetings
// of today and tomorrow, each with a "Prepare" pack. Read only, from the Outlook calendar.
import { useState } from 'react';
import { CalendarDays, CalendarX2, ClipboardList, TriangleAlert } from 'lucide-react';
import { assistant } from '../shared/client';
import type { AssistantActions } from '../shared/contract';
import type { DayHealth } from '../shared/types';
import { useAssistant, useTickChange } from './context';
import { Card, InlineError, Loading } from './Bits';
import { MeetingPrepDrawer } from './MeetingPrep';
import {
  addDaysIso,
  calendarFix,
  calendarNote,
  formatClock,
  formatLongDay,
  formatMinutes,
  istParts,
  shortHours,
  todayIst,
  useClock,
  useLoad,
} from './lib';

export type UpcomingEvent = AssistantActions['meetings.upcoming']['result']['events'][number];

const TONE: Record<DayHealth['label'], string> = {
  Light: 'green',
  Balanced: 'blue',
  Heavy: 'amber',
  Overloaded: 'red',
};
const weekday = (date: string, style: 'short' | 'long' = 'short') =>
  new Date(date + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: style, timeZone: 'UTC' });
const dayNumber = (date: string) => Number(date.slice(8, 10));

function CalendarNote({ status }: { status: string }) {
  const { navigate } = useAssistant();
  const note = calendarNote(status);
  if (!note) return null;
  const fix = calendarFix(status);
  return (
    <p className="as-quiet as-cal-note">
      <CalendarX2 size={15} aria-hidden="true" />
      <span>
        {note}{' '}
        {fix && (
          <button type="button" className="wf-link" onClick={() => navigate(fix)}>
            Open Outlook connection
          </button>
        )}
      </span>
    </p>
  );
}

// Explains a day's health in plain words, including how the score is made.
function DayDetail({ day }: { day: DayHealth }) {
  const parts = [
    day.meetings
      ? `${day.meetings} ${day.meetings === 1 ? 'meeting' : 'meetings'}, ${formatMinutes(day.meetingMinutes)} in all`
      : 'No meetings',
    day.focusMinutes
      ? `${formatMinutes(day.focusMinutes)} free for focus (longest block ${formatMinutes(day.longestFocus)})`
      : 'No free block of an hour or more',
  ];
  if (day.clashes) parts.push(`${day.clashes} ${day.clashes === 1 ? 'clash' : 'clashes'}`);
  if (day.backToBack) parts.push(`${day.backToBack} back to back`);
  return (
    <div className="as-day-detail" aria-live="polite">
      <p className="as-day-head">
        <strong>{formatLongDay(day.date)}</strong>
        <span className={'wf-pill ' + TONE[day.label]}>{day.label}</span>
        <span className="as-day-score">Score {day.score} of 100</span>
      </p>
      <ul className="as-day-facts">
        {parts.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <p className="as-quiet small">
        Counted from 9:30 am to 7:00 pm. The score starts at 100 and loses 12 for each meeting hour beyond 3,
        15 for each clash and 4 for each back-to-back pair; a focus block of up to 3 hours adds up to 10.
      </p>
    </div>
  );
}

export function WeekStrip() {
  const week = useLoad(() => assistant('schedule.week', {}));
  useTickChange(week.reload);
  const [picked, setPicked] = useState<string | null>(null);
  const today = todayIst();

  let body;
  if (week.phase === 'loading') body = <Loading>Reading your week</Loading>;
  else if (week.phase === 'error' || !week.data)
    body = <InlineError message={week.error} onRetry={week.retry} />;
  else {
    const { days, calendar } = week.data;
    const selected = days.find((d) => d.date === picked) ?? days.find((d) => d.date === today) ?? days[0];
    body = (
      <>
        <CalendarNote status={calendar} />
        {days.length > 0 && (
          <>
            <div className="as-week" role="group" aria-label="Choose a day">
              {days.map((d) => (
                <button
                  key={d.date}
                  type="button"
                  className={'as-day ' + TONE[d.label] + (selected?.date === d.date ? ' active' : '')}
                  aria-pressed={selected?.date === d.date}
                  aria-label={`${weekday(d.date, 'long')} ${dayNumber(d.date)}: ${d.label}, ${formatMinutes(
                    d.meetingMinutes,
                  )} of meetings, ${formatMinutes(d.focusMinutes)} of focus time${
                    d.clashes ? `, ${d.clashes} ${d.clashes === 1 ? 'clash' : 'clashes'}` : ''
                  }`}
                  onClick={() => setPicked(d.date)}
                >
                  <span className="as-day-name">{d.date === today ? 'Today' : weekday(d.date)}</span>
                  <span className="as-day-num">{dayNumber(d.date)}</span>
                  <span className="as-day-bar" aria-hidden="true" />
                  <span className="as-day-hours">
                    <span className="as-day-long">Meetings </span>
                    {shortHours(d.meetingMinutes)} h
                  </span>
                  <span className="as-day-focus">
                    <span className="as-day-long">Focus </span>
                    {shortHours(d.focusMinutes)} h
                  </span>
                  {d.clashes > 0 && (
                    <span className="as-day-clash">
                      <TriangleAlert size={11} aria-hidden="true" />
                      <span className="as-day-long">
                        {d.clashes} {d.clashes === 1 ? 'clash' : 'clashes'}
                      </span>
                    </span>
                  )}
                </button>
              ))}
            </div>
            <p className="as-quiet small as-week-hint">
              Hours of meetings each day. Tap a day for its detail.
            </p>
            {selected && <DayDetail day={selected} />}
          </>
        )}
      </>
    );
  }
  return (
    <Card title="Your week" id="as-today-week" className="as-week-card">
      {body}
    </Card>
  );
}

function eventTime(e: UpcomingEvent) {
  if (e.allDay) return 'All day';
  return `${formatClock(e.start)} to ${formatClock(e.end)}`;
}

export function UpcomingMeetings() {
  const now = useClock();
  const meetings = useLoad(() => assistant('meetings.upcoming', { days: 2 }));
  useTickChange(meetings.reload);
  const [prep, setPrep] = useState<UpcomingEvent | null>(null);
  const today = todayIst(now);
  const tomorrow = addDaysIso(today, 1);

  let body;
  if (meetings.phase === 'loading') body = <Loading>Loading your meetings</Loading>;
  else if (meetings.phase === 'error' || !meetings.data)
    body = <InlineError message={meetings.error} onRetry={meetings.retry} />;
  else {
    const { events, calendar } = meetings.data;
    const groups = [
      { label: 'Today', items: events.filter((e) => istParts(e.start).date <= today && e.end > now) },
      { label: 'Tomorrow', items: events.filter((e) => istParts(e.start).date === tomorrow) },
    ].filter((g) => g.items.length);
    body = (
      <>
        <CalendarNote status={calendar} />
        {calendar === 'ready' && groups.length === 0 && (
          <p className="as-quiet">
            <CalendarDays size={15} aria-hidden="true" /> No meetings today or tomorrow.
          </p>
        )}
        {groups.map((g) => (
          <div key={g.label} className="as-meet-group">
            <h3 className="as-meet-day">{g.label}</h3>
            <ul className="as-meets">
              {g.items.map((e) => {
                const live = !e.allDay && e.start <= now && e.end > now;
                return (
                  <li key={e.id} className="as-meet">
                    <div className="as-meet-main">
                      <p className="as-meet-time">
                        {eventTime(e)}
                        {live && <span className="wf-pill green as-pill-sm">Now</span>}
                        {e.clash && (
                          <span className="wf-pill red as-pill-sm" title="Overlaps another meeting">
                            Clash
                          </span>
                        )}
                      </p>
                      <p className="as-meet-subject">{e.subject || 'Untitled meeting'}</p>
                      {(e.place || e.matterLabel) && (
                        <p className="as-meet-meta">{[e.place, e.matterLabel].filter(Boolean).join(' · ')}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      className="button secondary small as-prepare"
                      onClick={() => setPrep(e)}
                      aria-label={'Prepare for ' + (e.subject || 'this meeting')}
                    >
                      <ClipboardList size={14} aria-hidden="true" /> Prepare
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </>
    );
  }
  // Without a readable calendar the week strip already says why; nothing to repeat here.
  if (meetings.data && meetings.data.calendar !== 'ready' && !meetings.data.events.length) return null;
  return (
    <Card title="Upcoming meetings" count={meetings.data?.events.length || undefined} id="as-today-meetings">
      {body}
      {prep && <MeetingPrepDrawer event={prep} onClose={() => setPrep(null)} />}
    </Card>
  );
}
