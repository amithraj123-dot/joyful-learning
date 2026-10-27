'use client';
// Meeting prep: who I am meeting (with the last email and any follow-up), the linked mandate's open
// tasks and deadlines, recent mail, my notes and my to-dos, assembled without AI. A short AI briefing
// is made only when asked, and kept for this meeting.
import { useState, type ReactNode } from 'react';
import {
  ArrowUpRight,
  BriefcaseBusiness,
  CalendarClock,
  ChevronRight,
  FileText,
  ListTodo,
  Mail,
  RefreshCw,
  Sparkles,
  Users,
  Video,
} from 'lucide-react';
import { assistant } from '../shared/client';
import type { MeetingPrep, MeetingPrepPerson } from '../shared/types';
import { Modal } from '../../workflow/ui/components/Modal';
import { useAssistant } from './context';
import { InlineError, LoadError, Loading, RichText } from './Bits';
import { errorMessage, formatAgo, formatClock, formatDay, formatWhen, istParts, useLoad } from './lib';
import type { UpcomingEvent } from './Schedule';

function Section({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: typeof Users;
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="as-prep-section">
      <h3>
        <Icon size={15} aria-hidden="true" /> {title}
        {count != null && <span className="as-count">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

function when(e: { start: number; end: number; allDay: boolean }) {
  const day = formatWhen(e.start).split(',')[0];
  return e.allDay ? `${day}, all day` : `${day}, ${formatClock(e.start)} to ${formatClock(e.end)}`;
}

function Person({ p }: { p: MeetingPrepPerson }) {
  const { open } = useAssistant();
  return (
    <li className="as-prep-person">
      <div className="as-prep-who">
        <strong>{p.name || p.address}</strong>
        {p.name && <small className="as-break">{p.address}</small>}
        <span className="as-prep-tags">
          {p.colleague && <span className="as-tag">Colleague</span>}
          {p.waitingOnThem && <span className="wf-pill amber as-pill-sm">You are waiting on them</span>}
          {p.chasingMe && <span className="wf-pill red as-pill-sm">Waiting on you</span>}
        </span>
      </div>
      {p.lastMail ? (
        <button
          type="button"
          className="as-line link as-prep-link"
          onClick={() => open('mail/inbox#' + p.lastMail!.mailId)}
        >
          <span>
            Last email: {p.lastMail.subject || '(no subject)'} <small>{formatAgo(p.lastMail.at)}</small>
          </span>
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      ) : (
        <p className="as-quiet small">No recent email with them.</p>
      )}
    </li>
  );
}

function Summary({ eventId, initial }: { eventId: string; initial: MeetingPrep['summary'] }) {
  const [summary, setSummary] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (refresh: boolean) => {
    setBusy(true);
    setError('');
    try {
      setSummary(await assistant('meetings.prepSummary', { eventId, refresh }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="as-prep-summary" aria-live="polite" aria-busy={busy}>
      <h3>
        <Sparkles size={15} aria-hidden="true" /> AI briefing
      </h3>
      {summary ? (
        <>
          <RichText text={summary.text} />
          <p className="as-prep-summary-meta">
            <span>Made {formatAgo(summary.at)} from the pack below. Check it before relying on it.</span>
            <button type="button" className="wf-link as-tap" onClick={() => void run(true)} disabled={busy}>
              <RefreshCw size={13} aria-hidden="true" /> {busy ? 'Summarising' : 'Refresh'}
            </button>
          </p>
        </>
      ) : (
        <>
          <p className="as-quiet small">
            A short briefing on purpose, people, open points, what to prepare and risks. It uses the firm AI
            service once for this meeting and is kept.
          </p>
          <button
            type="button"
            className="button primary small"
            onClick={() => void run(false)}
            disabled={busy}
          >
            <Sparkles size={14} aria-hidden="true" /> {busy ? 'Summarising' : 'Summarise with AI'}
          </button>
        </>
      )}
      {busy && <Loading>Summarising the pack. This can take up to a minute.</Loading>}
      <InlineError message={error} />
    </section>
  );
}

function PrepBody({ prep }: { prep: MeetingPrep }) {
  const { open } = useAssistant();
  const { event, people, mandate, recentMail, notes, todos } = prep;
  const nothing = !people.length && !mandate && !recentMail.length && !notes.length && !todos.length;
  return (
    <div className="as-prep">
      <div className="as-prep-when">
        <p>
          <CalendarClock size={15} aria-hidden="true" /> {when(event)}
          {event.place && <span> · {event.place}</span>}
        </p>
        <div className="as-prep-actions">
          {event.onlineUrl && (
            <a
              className="button secondary small"
              href={event.onlineUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Video size={14} aria-hidden="true" /> Join online
            </a>
          )}
          {event.webLink && (
            <a className="button ghost small" href={event.webLink} target="_blank" rel="noopener noreferrer">
              Open in Outlook <ArrowUpRight size={13} aria-hidden="true" />
            </a>
          )}
        </div>
      </div>

      <Summary eventId={event.id} initial={prep.summary} />

      {nothing && (
        <p className="as-quiet">
          Nothing else was found for this meeting: no other attendees, linked mandate, recent mail, notes or
          to-dos.
        </p>
      )}

      {people.length > 0 && (
        <Section icon={Users} title="People" count={people.length}>
          <ul className="as-prep-people">
            {people.map((p) => (
              <Person key={p.address} p={p} />
            ))}
          </ul>
        </Section>
      )}

      {mandate && (
        <Section icon={BriefcaseBusiness} title="Mandate">
          <button
            type="button"
            className="as-line link as-prep-link"
            onClick={() => open('workflow/matters#' + mandate.matterId)}
          >
            <strong>{mandate.label}</strong>
            <ChevronRight size={15} aria-hidden="true" />
          </button>
          {mandate.deadlines.length > 0 && (
            <>
              <h4>Deadlines</h4>
              <ul className="as-prep-list">
                {mandate.deadlines.map((d, i) => (
                  <li key={i}>
                    <span>{d.title}</span>
                    <small>{formatDay(d.dueDate)}</small>
                  </li>
                ))}
              </ul>
            </>
          )}
          <h4>Open tasks</h4>
          {mandate.openTasks.length ? (
            <ul className="as-prep-list">
              {mandate.openTasks.map((t, i) => (
                <li key={i}>
                  <span>{t.title}</span>
                  <small>
                    {[t.assignee, t.dueDate ? 'due ' + formatDay(t.dueDate) : '']
                      .filter(Boolean)
                      .join(', ') || 'Not assigned'}
                  </small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="as-quiet small">No open tasks on this mandate.</p>
          )}
        </Section>
      )}

      {recentMail.length > 0 && (
        <Section icon={Mail} title="Recent mail" count={recentMail.length}>
          <ul className="as-lines">
            {recentMail.map((m) => (
              <li key={m.mailId}>
                <button
                  type="button"
                  className="as-line link as-prep-mail"
                  onClick={() => open('mail/inbox#' + m.mailId)}
                >
                  <span>
                    <strong>{m.subject || '(no subject)'}</strong>
                    <small>
                      {m.from} · {formatAgo(m.at)}
                    </small>
                    {m.why && <small className="as-prep-why">{m.why}</small>}
                  </span>
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {notes.length > 0 && (
        <Section icon={FileText} title="Your notes" count={notes.length}>
          <ul className="as-lines">
            {notes.map((n) => (
              <li key={n.noteId}>
                <button
                  type="button"
                  className="as-line link as-prep-mail"
                  onClick={() => open('notes#' + n.noteId)}
                >
                  <span>
                    <strong>{n.title || 'Untitled note'}</strong>
                    <small>{formatDay(istParts(n.at).date)}</small>
                    {n.snippet && <small className="as-prep-why">{n.snippet}</small>}
                  </span>
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {todos.length > 0 && (
        <Section icon={ListTodo} title="Your to-dos on this" count={todos.length}>
          <ul className="as-prep-list">
            {todos.map((t) => (
              <li key={t.id}>
                <span>{t.title}</span>
                {t.dueAt != null && <small>Due {formatWhen(t.dueAt)}</small>}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

export function MeetingPrepDrawer({ event, onClose }: { event: UpcomingEvent; onClose: () => void }) {
  const prep = useLoad(() => assistant('meetings.prep', { eventId: event.id }));
  return (
    <Modal
      variant="drawer"
      title={event.subject || 'Untitled meeting'}
      subtitle="Meeting prep, from your mail, mandates, notes and to-dos"
      onClose={onClose}
    >
      {prep.phase === 'loading' ? (
        <Loading>Gathering what you need for this meeting</Loading>
      ) : prep.phase === 'error' || !prep.data ? (
        <LoadError
          title="The prep could not be loaded"
          message={prep.error}
          status={prep.status}
          onRetry={prep.retry}
        />
      ) : (
        <PrepBody prep={prep.data} />
      )}
    </Modal>
  );
}
