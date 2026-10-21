'use client';
import { useEffect, useRef, useState } from 'react';
import { runtime, isDesktop } from '../lib/desktop-runtime';
import { type Note } from '../lib/workspace-core';
import { noteDetails, type ContextFile } from '../lib/note-details';
import { newId } from '../lib/flow-core';
const providers: Record<string, string> = {
  gmail: 'Gmail',
  outlook: 'Outlook email',
  slack: 'Slack channel',
  notion: 'Notion page',
  hubspot: 'HubSpot record',
  attio: 'Attio record',
  affinity: 'Affinity record',
  zapier: 'Zapier workflow',
  'google-event': 'Google Calendar event',
  'outlook-event': 'Outlook Calendar event',
};
const kinds: Record<string, string[]> = {
  hubspot: ['contacts', 'companies', 'deals'],
  attio: ['people', 'companies', 'deals'],
  affinity: ['persons', 'organizations', 'opportunities'],
};
export function NoteWorkflows({
  note,
  onSave,
  onContext,
}: {
  note: Note;
  onSave: () => Promise<Note | undefined>;
  onContext: (context: ContextFile[]) => void;
}) {
  const [native, setNative] = useState(false),
    [provider, setProvider] = useState('gmail'),
    [kind, setKind] = useState('contacts'),
    [target, setTarget] = useState(''),
    [title, setTitle] = useState(''),
    [body, setBody] = useState(''),
    [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [review, setReview] = useState<any>(null),
    [checked, setChecked] = useState(false),
    [history, setHistory] = useState<any[]>([]),
    [mailProvider, setMailProvider] = useState('google'),
    [addresses, setAddresses] = useState(''),
    [mail, setMail] = useState<any>(null),
    [chosen, setChosen] = useState<string[]>([]);
  const generation = useRef(0);
  useEffect(() => setNative(isDesktop()), []);
  useEffect(() => {
    generation.current++;
    setTitle(note.title);
    setBody(noteDetails(note).followUp || note.summary || note.body);
    setTarget('');
    setReview(null);
    setChecked(false);
    setMail(null);
    setChosen([]);
    setError('');
    setBusy(false);
    setAddresses(noteDetails(note).attendees.slice(0, 5).join(', '));
    if (isDesktop())
      void runtime('integrations.history')
        .then(setHistory)
        .catch((e) => setError(e.message));
  }, [note.id]);
  const run = async (fn: (g: number) => Promise<void>) => {
    const g = generation.current;
    setBusy(true);
    setError('');
    try {
      await fn(g);
    } catch (e: any) {
      if (g === generation.current) setError(e.message);
    } finally {
      if (g === generation.current) setBusy(false);
    }
  };
  const prepare = () =>
    run(async (g) => {
      const saved = await onSave();
      if (!saved) throw Error('Save this note before preparing an action.');
      const r = await runtime('integrations.prepare', {
        provider,
        noteId: note.id,
        kind,
        target,
        title,
        body,
        ...(provider.endsWith('-event')
          ? { start: new Date(start).toISOString(), end: new Date(end).toISOString() }
          : {}),
      });
      if (g === generation.current) {
        setReview(r);
        setChecked(false);
      }
    });
  const send = () =>
    run(async (g) => {
      const r = await runtime('integrations.commit', { id: review.id, reviewed: checked });
      if (g === generation.current) {
        setReview(r);
        setChecked(false);
        setHistory(await runtime('integrations.history'));
      }
    });
  const attachMail = () => {
    const d = noteDetails(note),
      messages = mail.messages.filter((m: any) => chosen.includes(m.id));
    const text = [
      mail.coverage,
      ...messages.map(
        (m: any) =>
          `Subject: ${m.subject}\nFrom: ${m.from}\nDate: ${m.date}\nMessage preview (not full thread): ${m.text}`,
      ),
    ]
      .join('\n\n')
      .slice(0, 30000);
    if (d.context.length >= 10 || d.context.reduce((n, c) => n + c.text.length, 0) + text.length > 100000) {
      setError('This note has reached its attachment limit.');
      return;
    }
    onContext([
      ...d.context,
      { id: newId(), name: mailProvider + '-email-previews.txt', text, at: Date.now() },
    ]);
    setMail(null);
    setChosen([]);
  };
  if (!native)
    return (
      <details className="studio-details">
        <summary>Connected actions</summary>
        <p className="small-print">
          Open this note in the Windows app to connect Gmail, Outlook, Slack, Notion, Zapier or a CRM and
          review an action. The hosted workspace’s connector access is not configured.
        </p>
      </details>
    );
  return (
    <>
      <details className="studio-details">
        <summary>Send, publish or schedule</summary>
        <p className="small-print">
          Choose an account in Desktop settings first. Only the title and text shown below are sent. Full
          transcripts and attachments are not sent unless you deliberately include their text.
        </p>
        {error && (
          <p className="notice warning" role="alert">
            {error}
          </p>
        )}
        {!review ? (
          <>
            <label className="field">
              <span>Destination</span>
              <select
                value={provider}
                disabled={busy}
                onChange={(e) => {
                  setProvider(e.target.value);
                  setKind(kinds[e.target.value]?.[0] || '');
                  setTarget('');
                }}
              >
                {Object.entries(providers).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            {kinds[provider] && (
              <label className="field">
                <span>Record type</span>
                <select value={kind} disabled={busy} onChange={(e) => setKind(e.target.value)}>
                  {kinds[provider].map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </label>
            )}
            {provider !== 'zapier' && (
              <label className="field">
                <span>
                  {['gmail', 'outlook', 'google-event', 'outlook-event'].includes(provider)
                    ? 'Recipient / attendee emails · comma separated'
                    : provider === 'slack'
                      ? 'Slack channel ID'
                      : provider === 'notion'
                        ? 'Parent Notion page ID'
                        : 'Exact CRM record ID'}
                </span>
                <input
                  value={target}
                  disabled={busy}
                  maxLength={6000}
                  onChange={(e) => setTarget(e.target.value)}
                />
              </label>
            )}
            {provider.endsWith('-event') && (
              <>
                <p className="small-print">
                  Times use {Intl.DateTimeFormat().resolvedOptions().timeZone}. Adding attendees will send
                  invitations when you confirm.
                </p>
                <div className="studio-grid">
                  <label className="field">
                    <span>Starts</span>
                    <input
                      type="datetime-local"
                      value={start}
                      disabled={busy}
                      onChange={(e) => setStart(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Ends</span>
                    <input
                      type="datetime-local"
                      value={end}
                      disabled={busy}
                      onChange={(e) => setEnd(e.target.value)}
                    />
                  </label>
                </div>
              </>
            )}
            <label className="field">
              <span>Subject / title</span>
              <input
                value={title}
                disabled={busy}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Text to send</span>
              <textarea
                value={body}
                disabled={busy}
                maxLength={30000}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
              />
            </label>
            <div className="inline-actions wrap">
              <button
                className="button ghost"
                disabled={busy}
                onClick={() => {
                  setTitle(note.title);
                  setBody(noteDetails(note).followUp || note.summary || note.body);
                }}
              >
                Use latest note draft
              </button>
              <button
                className="button secondary"
                disabled={
                  busy || !body.trim() || !title.trim() || (provider.endsWith('-event') && (!start || !end))
                }
                onClick={() => void prepare()}
              >
                {busy ? 'Preparing…' : 'Verify destination & preview'}
              </button>
            </div>
          </>
        ) : (
          <div className="studio-review">
            <h4>{review.state === 'review' ? 'Review before sending' : review.state}</h4>
            <p>
              <strong>
                {['gmail', 'outlook', 'google-event', 'outlook-event'].includes(review.provider)
                  ? 'Account:'
                  : 'Connection label (provided by you):'}
              </strong>{' '}
              {review.account}
            </p>
            <p>
              <strong>Destination:</strong> {providers[review.provider]} · {review.targetLabel}
            </p>
            {review.start && (
              <p>
                <strong>When:</strong> {new Date(review.start).toLocaleString()} —{' '}
                {new Date(review.end).toLocaleString()} · {Intl.DateTimeFormat().resolvedOptions().timeZone}
              </p>
            )}
            {!!review.conflicts?.length && (
              <p className="notice warning">
                <strong>Calendar overlaps:</strong> {review.conflicts.join('; ')}. Confirm the overlap is
                intentional before creating this event.
              </p>
            )}
            <strong>{review.title}</strong>
            {review.body && <pre className="workflow-preview">{review.body}</pre>}
            {review.state === 'review' ? (
              <>
                <label className="toggle-row">
                  <span>
                    I checked the account, destination{review.start ? ', time and attendees' : ''} and
                    content.
                  </span>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busy}
                    onChange={(e) => setChecked(e.target.checked)}
                  />
                </label>
                {review.provider === 'zapier' && (
                  <p className="notice warning">
                    Your Zap may trigger further actions outside Flow. Check its configured steps before
                    sending.
                  </p>
                )}
                <button className="button primary" disabled={busy || !checked} onClick={() => void send()}>
                  {busy
                    ? 'Submitting…'
                    : review.provider.endsWith('-event')
                      ? 'Create reviewed event'
                      : review.provider === 'gmail' || review.provider === 'outlook'
                        ? 'Send reviewed email'
                        : 'Publish reviewed text'}
                </button>
                <button
                  className="button ghost"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await runtime('integrations.discard', { id: review.id });
                      setReview(null);
                    })
                  }
                >
                  Discard preview
                </button>
                <p className="small-print">
                  Preview expires in 15 minutes. Editing the saved note or changing accounts requires a fresh
                  preview.
                </p>
              </>
            ) : (
              <>
                <p role="status">{review.result || review.error}</p>
                {review.state === 'uncertain' && (
                  <p className="notice warning">
                    Check the provider before trying again. Flow will not automatically replay this action.
                  </p>
                )}
                <button className="button ghost" onClick={() => setReview(null)}>
                  Close receipt
                </button>
              </>
            )}
          </div>
        )}
        <details>
          <summary>Delivery history for this note</summary>
          {history
            .filter((h) => h.noteId === note.id)
            .map((h) => (
              <article className="context-file" key={h.id}>
                <strong>
                  {providers[h.provider]} · {h.state}
                </strong>
                <small>
                  {new Date(h.createdAt).toLocaleString()} · {h.targetLabel}
                </small>
                <p>{h.result || h.error || 'Not submitted'}</p>
              </article>
            ))}
        </details>
      </details>
      <details className="studio-details">
        <summary>Bring in relevant email context</summary>
        <p className="small-print">
          Read message previews for up to five exact addresses. Choose which previews to attach. Once
          attached, the text follows the note’s sharing, sync and AI settings.
        </p>
        <label className="field">
          <span>Mail account</span>
          <select
            value={mailProvider}
            disabled={busy}
            onChange={(e) => {
              setMailProvider(e.target.value);
              setMail(null);
            }}
          >
            <option value="google">Gmail</option>
            <option value="microsoft">Outlook</option>
          </select>
        </label>
        <label className="field">
          <span>Participant email addresses</span>
          <input
            value={addresses}
            maxLength={1300}
            onChange={(e) => setAddresses(e.target.value)}
            disabled={busy}
          />
        </label>
        <button
          className="button secondary"
          disabled={busy || !addresses.trim()}
          onClick={() =>
            void run(async (g) => {
              const r = await runtime('integrations.mailContext', { provider: mailProvider, addresses });
              if (g === generation.current) {
                setMail(r);
                setChosen([]);
              }
            })
          }
        >
          Find message previews
        </button>
        {mail && (
          <>
            <p>
              {mail.account} · {mail.coverage}
            </p>
            {!mail.messages.length && <p>No matching message previews were returned.</p>}
            {mail.messages.map((m: any) => (
              <label className="mail-context" key={m.id}>
                <input
                  type="checkbox"
                  checked={chosen.includes(m.id)}
                  onChange={(e) =>
                    setChosen(e.target.checked ? [...chosen, m.id] : chosen.filter((x) => x !== m.id))
                  }
                />
                <span>
                  <strong>{m.subject || '(No subject)'}</strong>
                  <small>
                    {m.from} · {m.date}
                  </small>
                  <p>{m.text}</p>
                </span>
              </label>
            ))}
            <button className="button secondary" disabled={!chosen.length} onClick={attachMail}>
              Attach selected previews to draft
            </button>
          </>
        )}
      </details>
    </>
  );
}
