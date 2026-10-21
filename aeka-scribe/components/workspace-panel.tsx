'use client';
import { useEffect, useRef, useState } from 'react';
import { DesktopConnections } from './desktop-connections';
import {
  CalendarDays,
  FileText,
  FolderOpen,
  Plus,
  Mic,
  Square,
  Pause,
  Play,
  Search,
  Download,
  Trash2,
  RefreshCw,
  Monitor,
  ArrowUpRight,
  Sparkles,
  Send,
  Check,
  ShieldCheck,
  Settings2,
  Copy,
  Undo2,
} from 'lucide-react';
import { isDesktop, runtime, processAudio, type DesktopEvent } from '../lib/desktop-runtime';
import { newId, reviewChanges, type Term, type Snippet } from '../lib/flow-core';
import {
  exportNote,
  transcriptText,
  citationsFromAnswer,
  type Note,
  type CalendarEvent,
} from '../lib/workspace-core';
import { TeamPanel } from './team-panel';
import { DesktopAdvanced, MeetingAutomation } from './desktop-advanced';
import { noteDetails, isTrashed, inFolder, noteFolders } from '../lib/note-details';
import { type ChatScope } from '../lib/meeting-studio';
import {
  NoteStudio,
  TranscriptEditor,
  StudioSettings,
  MeetingChat,
  PeoplePanel,
  TrashPanel,
  useStudioConfig,
} from './meeting-studio';
import { useMeetingRecorder } from '../hooks/use-meeting-recorder';
export type WorkspacePage =
  'meetings' | 'notes' | 'ask' | 'transforms' | 'desktop' | 'team' | 'people' | 'recipes' | 'trash';
type Props = {
  page: string;
  deviceId: string;
  language: string;
  terms: Term[];
  snippets: Snippet[];
  onImportResources: (r: { terms: Term[]; snippets: Snippet[] }) => void;
  dictationBusy: boolean;
  notify: (text: string) => void;
  onNavigate: (page: WorkspacePage) => void;
  onStatusChange: () => void;
  onMeetingBusy: (busy: boolean) => void;
};
type QueueItem = { id: string; noteId: string; start: number; end: number; error: string };
const stamp = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;
const download = (name: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const fieldKeys = ['title', 'body', 'summary', 'folder', 'speakers', 'details', 'segments'] as const;
export function WorkspacePanel(props: Props) {
  const { page, notify, onNavigate } = props;
  const [native, setNative] = useState(false),
    [notes, setNotes] = useState<Note[]>([]),
    [selected, setSelected] = useState(''),
    [draft, setDraft] = useState<Note | null>(null),
    [base, setBase] = useState<Note | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [signInPath, setSignInPath] = useState(''),
    [busy, setBusy] = useState(''),
    [query, setQuery] = useState(''),
    [folder, setFolder] = useState(''),
    [queue, setQueue] = useState<QueueItem[]>([]),
    [events, setEvents] = useState<CalendarEvent[]>([]),
    [calendarErrors, setCalendarErrors] = useState<string[]>([]),
    [refreshedAt, setRefreshedAt] = useState<number | null>(null),
    [systemAudio, setSystemAudio] = useState(true),
    [consent, setConsent] = useState(false),
    [reminder, setReminder] = useState<CalendarEvent | null>(null),
    [call, setCall] = useState(''),
    [question, setQuestion] = useState(''),
    [answer, setAnswer] = useState(''),
    [chosen, setChosen] = useState<string[]>([]),
    [transformText, setTransformText] = useState(''),
    [transformed, setTransformed] = useState(''),
    [instruction, setInstruction] = useState('Polish grammar and punctuation while preserving my voice.'),
    [undo, setUndo] = useState(''),
    [configured, setConfigured] = useState(false),
    [customTransforms, setCustomTransforms] = useState<string[]>([]);
  const studio = useStudioConfig();
  const [chatScope, setChatScope] = useState<ChatScope>({}),
    [starredOnly, setStarredOnly] = useState(false);
  const automationAction = useRef<(e: DesktopEvent) => Promise<void>>(async () => {}),
    autoId = useRef(''),
    autoNote = useRef('');
  const [countdown, setCountdown] = useState<any>(null),
    [clock, setClock] = useState(Date.now());
  const notesRef = useRef(notes),
    draftRef = useRef(draft),
    baseRef = useRef(base),
    selectedRef = useRef(selected);
  notesRef.current = notes;
  draftRef.current = draft;
  baseRef.current = base;
  selectedRef.current = selected;
  const dirty =
    !!draft && !!base && fieldKeys.some((k) => JSON.stringify(draft[k]) !== JSON.stringify(base[k]));
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const load = async () => {
    try {
      const all = (await runtime('notes.list')) as Note[];
      setNotes(all);
      const fresh = all.find((n) => n.id === selectedRef.current);
      if (fresh && !dirtyRef.current) {
        setDraft(fresh);
        setBase(fresh);
      } else if (fresh && draftRef.current && baseRef.current) {
        const current = draftRef.current,
          original = baseRef.current,
          next = { ...fresh },
          nextBase = { ...fresh };
        for (const key of fieldKeys)
          if (JSON.stringify(current[key]) !== JSON.stringify(original[key])) {
            (next as any)[key] = current[key];
            (nextBase as any)[key] = original[key];
          }
        setDraft(next);
        setBase(nextBase);
      }
      setError('');
      return all;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load notes.');
      if (e && typeof e === 'object' && 'signInPath' in e) setSignInPath(String(e.signInPath));
      return notesRef.current;
    }
  };
  const loadQueue = async () => {
    try {
      setQueue(await runtime('queue.list'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read pending audio.');
    }
  };
  const run = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    setError('');
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The action could not finish.');
      if (e && typeof e === 'object' && 'signInPath' in e) setSignInPath(String(e.signInPath));
    } finally {
      setBusy('');
    }
  };
  const refreshCalendar = async () => {
    const r = await runtime('calendar.events');
    setEvents(r.events);
    setCalendarErrors(
      r.errors.map((x: { provider: string; message: string }) => x.provider + ': ' + x.message),
    );
    setRefreshedAt(r.refreshedAt);
  };
  const recorder = useMeetingRecorder(async (id, duration) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const all = (await runtime('notes.list')) as Note[],
        n = all.find((x) => x.id === id);
      if (!n) break;
      try {
        await runtime('notes.save', {
          note: { ...n, status: 'complete', duration: Math.max(n.duration, duration) },
          baseUpdatedAt: n.updatedAt,
        });
        break;
      } catch (e) {
        if (attempt === 2) throw e;
      }
    }
    await load();
    await loadQueue();
    notify('Recording saved. Pending audio will transcribe when the speech engine is available.');
  });
  const actions = useRef({ load, loadQueue });
  actions.current = { load, loadQueue };
  useEffect(() => {
    setNative(isDesktop());
    setLoading(true);
    // allSettled: one failing request (e.g. status while offline) must not leave an unhandled rejection
    // or block the notes and queue from loading.
    void Promise.allSettled([
      load(),
      loadQueue(),
      runtime('status').then((d) => setConfigured(d.openaiConfigured)),
    ]).finally(() => setLoading(false));
    const onNotes = () => void actions.current.load(),
      onQueue = () => void actions.current.loadQueue();
    window.addEventListener('flow-notes-changed', onNotes);
    window.addEventListener('flow-queue-changed', onQueue);
    try {
      if (isDesktop())
        void runtime('status')
          .then((d) => setCustomTransforms(d.settings?.customTransforms || []))
          .catch(() => {});
      else setCustomTransforms(JSON.parse(localStorage.getItem('flow-transforms') || '[]'));
    } catch {}
    const off = window.flowDesktop?.on((e: DesktopEvent) => {
      if (e.type === 'app-finish') void automationAction.current({ type: 'finish-all' });
      if (e.type === 'automation-start' || e.type === 'automation-stop') void automationAction.current(e);
      if (e.type === 'automation-countdown') setCountdown(e.entry);
      if (e.type === 'automation-changed')
        void runtime('automation.list').then((list) =>
          setCountdown(list.find((x: any) => x.state === 'countdown') || null),
        );
      if (e.type === 'notes-changed') onNotes();
      if (e.type === 'queue-changed') onQueue();
      if (e.type === 'reminder') setReminder(e.event as CalendarEvent);
      if (e.type === 'call-detected') setCall(String(e.process || 'Call'));
      if (e.type === 'command') {
        setTransformText(String(e.text || ''));
        setTransformed('');
        onNavigate('transforms');
      }
      if (e.type === 'notice') notify(String(e.message || ''));
    });
    const online = () => {
      void runtime('queue.retry');
    };
    window.addEventListener('online', online);
    const timer = setInterval(() => void processAudio(), 60000);
    return () => {
      off?.();
      window.removeEventListener('flow-notes-changed', onNotes);
      window.removeEventListener('flow-queue-changed', onQueue);
      window.removeEventListener('online', online);
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!countdown) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [!!countdown]);
  useEffect(() => {
    props.onMeetingBusy(recorder.active);
  }, [recorder.active]);
  useEffect(() => {
    if (isDesktop() || !['meetings', 'notes', 'ask', 'team', 'people', 'trash'].includes(page)) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void actions.current.load();
    }, 15000);
    return () => clearInterval(timer);
  }, [page]);
  useEffect(() => {
    if (['meetings', 'notes'].includes(page)) void studio.reload();
    if (page === 'meetings') void run('calendar', refreshCalendar);
    if (['ask', 'transforms', 'desktop', 'notes', 'meetings'].includes(page))
      void runtime('status')
        .then((d) => setConfigured(d.openaiConfigured))
        .catch(() => {});
  }, [page]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current || recorder.active) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, [recorder.active]);
  const open = (n: Note) => {
    if (dirty && !confirm('Discard unsaved note edits?')) return;
    setSelected(n.id);
    setDraft(n);
    setBase(n);
  };
  const create = async (kind: Note['kind'], event?: CalendarEvent) => {
    if (dirty && !confirm('Discard unsaved note edits?')) return;
    const now = Date.now();
    const n: Note = {
      id: newId(),
      title:
        event?.title ||
        (kind === 'meeting' ? 'Meeting · ' + new Date().toLocaleDateString() : 'Untitled note'),
      kind,
      createdAt: now,
      updatedAt: now,
      folder,
      body: '',
      summary: '',
      segments: [],
      speakers: {},
      eventId: event?.id || '',
      status: 'draft',
      duration: 0,
      details: {
        ...noteDetails({}),
        templateId: studio.config.defaultTemplate,
        attendees: event?.attendees || [],
        eventStart: event?.start || '',
        eventEnd: event?.end || '',
        eventUrl: event?.url || '',
      },
    };
    const saved = await runtime('notes.save', { note: n });
    setNotes((old) => [saved, ...old]);
    setSelected(saved.id);
    setDraft(saved);
    setBase(saved);
    return saved as Note;
  };
  const saveDraft = async () => {
    const draft = draftRef.current,
      base = baseRef.current;
    if (!draft || !base) return;
    const all = (await runtime('notes.list')) as Note[],
      latest = all.find((x) => x.id === draft.id);
    if (!latest) throw Error('This note was deleted elsewhere. Copy your edits before refreshing.');
    const updates: Record<string, unknown> = {};
    for (const key of fieldKeys) {
      if (JSON.stringify(draft[key]) === JSON.stringify(base[key])) continue;
      if (
        JSON.stringify(latest[key]) !== JSON.stringify(base[key]) &&
        JSON.stringify(latest[key]) !== JSON.stringify(draft[key])
      )
        throw Error('“' + key + '” changed elsewhere. Copy your edits, then reload this note.');
      updates[key] = draft[key];
    }
    const saved = await runtime('notes.save', {
      note: { ...latest, ...updates },
      baseUpdatedAt: latest.updatedAt,
    });
    if (selectedRef.current === saved.id) {
      setDraft((current) => {
        if (!current || current.id !== saved.id) return current;
        const next = { ...saved };
        for (const key of fieldKeys)
          if (JSON.stringify(current[key]) !== JSON.stringify(draft[key])) (next as any)[key] = current[key];
        return next;
      });
      setBase(saved);
    }
    setNotes((old) => old.map((n) => (n.id === saved.id ? saved : n)));
    notify('Note saved');
    return saved as Note;
  };
  const startMeeting = async (note?: Note, event?: CalendarEvent, automated?: { systemAudio: boolean }) => {
    if (props.dictationBusy) throw Error('Finish dictation before starting a meeting recording.');
    if (!consent && !automated) throw Error('Confirm you have informed the participants before recording.');
    const n = note || (await create('meeting', event));
    if (!n) return;
    const all = (await runtime('notes.list')) as Note[],
      fresh = all.find((x) => x.id === n.id) || n;
    if (automated) {
      autoNote.current = n.id;
      const schedules = await runtime('automation.list');
      if (!schedules.some((x: any) => x.id === event?.id && x.state === 'starting'))
        return { id: n.id, started: false };
    }
    await runtime('notes.save', { note: { ...fresh, status: 'recording' }, baseUpdatedAt: fresh.updatedAt });
    setCall('');
    onNavigate('meetings');
    const started = await recorder.start({
      noteId: n.id,
      systemAudio: automated ? automated.systemAudio : systemAudio,
      deviceId: props.deviceId,
      language: props.language.split('-')[0],
      keywords: props.terms.map((t) => t.replacement),
      offset: fresh.duration,
    });
    if (!started) {
      const current = ((await runtime('notes.list')) as Note[]).find((x) => x.id === n.id);
      if (current)
        await runtime('notes.save', {
          note: { ...current, status: 'interrupted' },
          baseUpdatedAt: current.updatedAt,
        });
    }
    await load();
    return { id: n.id, started: !!started };
  };
  automationAction.current = async (e) => {
    try {
      if (e.type === 'finish-all') {
        await recorder.finish();
        return;
      }
      if (e.type === 'automation-stop') {
        if (autoId.current === e.id) {
          if (autoNote.current && recorder.currentNoteId() === autoNote.current) await recorder.finish();
          autoId.current = '';
        }
        return;
      }
      const entry = e.entry as any;
      autoId.current = entry.id;
      autoNote.current = '';
      setCountdown(null);
      if (dirtyRef.current || recorder.active || props.dictationBusy)
        throw Error('Automatic recording skipped because another task or unsaved note is open.');
      const list = await runtime('automation.list');
      if (!list.some((x: any) => x.id === entry.id && x.state === 'starting')) return;
      const result = await startMeeting(undefined, e.event as CalendarEvent, {
        systemAudio: entry.systemAudio,
      });
      await runtime('automation.started', {
        id: entry.id,
        noteId: result?.id,
        success: result?.started === true,
      });
    } catch (err: any) {
      if (autoNote.current && recorder.currentNoteId() === autoNote.current) await recorder.finish();
      if (e.entry)
        await runtime('automation.started', { id: (e.entry as any).id, success: false }).catch(() => {});
      setError(err.message || 'Automatic recording could not start.');
    }
  };
  const activeNotes = notes.filter((n) => !isTrashed(n));
  const filtered = activeNotes.filter(
    (n) =>
      (!starredOnly || noteDetails(n).starred) &&
      (page !== 'meetings' || n.kind === 'meeting') &&
      (!folder || inFolder(n, folder)) &&
      [
        n.title,
        n.body,
        n.summary,
        transcriptText(n),
        noteDetails(n).tags.join(' '),
        noteDetails(n).attendees.join(' '),
      ]
        .join(' ')
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const folders = [...new Set(activeNotes.flatMap(noteFolders))].sort();
  const openId = (id: string) => {
    const n = activeNotes.find((n) => n.id === id);
    if (n) {
      open(n);
      onNavigate('notes');
    }
  };
  const changeDraft = (next: Note) => setDraft((current) => (current?.id === next.id ? next : current));
  const visible = [
    'meetings',
    'notes',
    'ask',
    'transforms',
    'desktop',
    'team',
    'people',
    'recipes',
    'trash',
  ].includes(page);
  return (
    <>
      <div style={{ display: visible ? 'block' : 'none' }} className="workspace-extension">
        {error && (
          <div className="notice warning" role="alert">
            <span>{error}</span>
            {signInPath.startsWith('/signin-with-chatgpt?') ? (
              <a href={signInPath} target="_top">
                Sign in with ChatGPT
              </a>
            ) : (
              <button onClick={() => void run('reload', load)}>Retry</button>
            )}
          </div>
        )}
        {(page === 'meetings' || page === 'notes') && (
          <>
            {page === 'meetings' && (
              <>
                <section className="meeting-hero">
                  <div>
                    <span className="eyebrow">MEETING RECORDER</span>
                    <h2>Record a Meeting</h2>
                    <p>
                      Record a meeting, keep your own notes, and turn the transcript into decisions and next
                      steps.
                    </p>
                    <div className="meeting-controls">
                      <label>
                        <input
                          type="checkbox"
                          checked={systemAudio}
                          disabled={recorder.active}
                          onChange={(e) => setSystemAudio(e.target.checked)}
                        />{' '}
                        Microphone + system audio
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={consent}
                          disabled={recorder.active}
                          onChange={(e) => setConsent(e.target.checked)}
                        />{' '}
                        Participants know I’m recording
                      </label>
                    </div>
                    {!recorder.active ? (
                      <button
                        className="button primary"
                        disabled={!!busy || props.dictationBusy || !consent}
                        onClick={() => void run('record', () => startMeeting())}
                      >
                        <Mic size={17} />
                        Record a meeting
                      </button>
                    ) : (
                      <div className="inline-actions wrap">
                        <span className="record-clock">
                          <i style={{ opacity: 0.35 + recorder.level }} />
                          {recorder.phase} · {stamp(recorder.elapsed)}
                        </span>
                        <button
                          className="button secondary"
                          disabled={!['recording', 'paused'].includes(recorder.phase)}
                          onClick={recorder.pause}
                        >
                          {recorder.phase === 'paused' ? <Play size={16} /> : <Pause size={16} />}{' '}
                          {recorder.phase === 'paused' ? 'Resume' : 'Pause'}
                        </button>
                        <button
                          className="button primary"
                          disabled={recorder.phase === 'stopping'}
                          onClick={() => void recorder.finish()}
                        >
                          <Square size={14} />
                          Finish meeting
                        </button>
                      </div>
                    )}
                    <small>
                      {native
                        ? 'Windows loopback captures what you hear.'
                        : 'For shared audio, choose a supported tab or screen and enable Share audio.'}{' '}
                      Saved audio can wait for a connection. Transcription uses your selected speech engine.
                    </small>
                  </div>
                  <div className="meeting-art" aria-hidden="true">
                    <div className="orbit">
                      <AudioGlyph />
                    </div>
                    <span className="art-note">
                      <Check size={14} />
                      No meeting bot joins the call
                    </span>
                  </div>
                </section>
                {recorder.error && (
                  <div className="notice warning" role="alert">
                    {recorder.error}
                    {recorder.recoveryCount > 0 && (
                      <button onClick={recorder.saveRecovery}>
                        Download unsaved audio ({recorder.recoveryCount})
                      </button>
                    )}
                  </div>
                )}
                {!!queue.length && (
                  <div className="notice">
                    <span>
                      <strong>
                        {queue.length} audio segment{queue.length === 1 ? '' : 's'} pending
                      </strong>{' '}
                      ·{' '}
                      {queue.some((q) => q.error)
                        ? queue.find((q) => q.error)?.error
                        : 'Saved on this device. Keep Aeka Scribe open to process the queue.'}
                    </span>
                    <button
                      onClick={() =>
                        void run('retry', async () => {
                          await runtime('queue.retry');
                          await loadQueue();
                        })
                      }
                    >
                      <RefreshCw size={14} />
                      Retry transcription
                    </button>
                  </div>
                )}
                <section className="card calendar-card">
                  <div className="card-heading">
                    <h2>
                      <CalendarDays size={18} />
                      Coming up
                    </h2>
                    <button
                      className="button ghost"
                      disabled={busy === 'calendar'}
                      onClick={() => void run('calendar', refreshCalendar)}
                    >
                      <RefreshCw size={14} />
                      Refresh
                    </button>
                  </div>
                  {calendarErrors.map((e) => (
                    <p className="inline-error" key={e}>
                      {e}
                    </p>
                  ))}
                  {events.length ? (
                    <div className="event-list">
                      {events.slice(0, 15).map((e) => (
                        <article className="event-row" key={e.id}>
                          <div className="event-date">
                            <strong>
                              {new Date(e.start).toLocaleDateString(undefined, { day: 'numeric' })}
                            </strong>
                            <span>{new Date(e.start).toLocaleDateString(undefined, { month: 'short' })}</span>
                          </div>
                          <div>
                            <h3>{e.title}</h3>
                            <p>
                              {new Date(e.start).toLocaleString(undefined, {
                                weekday: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}{' '}
                              · {e.provider}
                              {e.attendees.length ? ` · ${e.attendees.length} invitees` : ''}
                            </p>
                          </div>
                          <div className="inline-actions">
                            <button
                              className="button secondary"
                              disabled={!e.url}
                              onClick={() => void run('join', () => runtime('calendar.join', { id: e.id }))}
                            >
                              Join <ArrowUpRight size={14} />
                            </button>
                            <button
                              className="button ghost"
                              disabled={!!busy}
                              onClick={() => void run('prepare', () => create('meeting', e))}
                            >
                              Prepare note
                            </button>
                            <button
                              className="button ghost"
                              disabled={recorder.active || !consent || props.dictationBusy}
                              onClick={() => void run('record', () => startMeeting(undefined, e))}
                            >
                              <Mic size={14} />
                              Record
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="calendar-empty">
                      <CalendarDays size={28} />
                      <div>
                        <h3>
                          {native
                            ? 'Your next meeting belongs here.'
                            : 'Calendar access lives in the Windows app.'}
                        </h3>
                        <p>
                          {native
                            ? 'Connect Google Calendar or Outlook in Desktop settings. Events from the next 14 days appear here.'
                            : 'The ChatGPT Google Calendar connection is enabled, but hosted calendar access has not been enabled for this workspace. Use the desktop calendar sign-in.'}
                        </p>
                      </div>
                      <button className="button secondary" onClick={() => onNavigate('desktop')}>
                        Calendar setup
                      </button>
                    </div>
                  )}
                  {refreshedAt && (
                    <p className="small-print calendar-sync">
                      Refreshed {new Date(refreshedAt).toLocaleTimeString()} · Up to 250 events per account
                    </p>
                  )}
                </section>
                {native && <MeetingAutomation events={events} />}
              </>
            )}
            <div className="notes-toolbar">
              <div className="search-box">
                <Search size={17} />
                <input
                  aria-label="Search notes and transcripts"
                  placeholder="Search notes and transcripts…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <select
                aria-label="Filter by folder"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
              >
                <option value="">All folders</option>
                {folders.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
              <button
                className="button secondary"
                disabled={!!busy}
                onClick={() =>
                  void run('create', () => create(page === 'meetings' ? 'meeting' : 'scratchpad'))
                }
              >
                <Plus size={15} />
                {page === 'meetings' ? 'Meeting note' : 'New scratchpad'}
              </button>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={starredOnly}
                  onChange={(e) => setStarredOnly(e.target.checked)}
                />
                Starred
              </label>
              <button
                aria-label="Refresh notes"
                className="icon-button"
                onClick={() => void run('reload', load)}
              >
                <RefreshCw size={16} />
              </button>
            </div>
            <div className="notes-layout">
              <aside className="notes-list">
                {loading ? (
                  <p className="empty-inline">Loading your notes…</p>
                ) : !filtered.length ? (
                  <div className="notes-empty">
                    <FileText size={28} />
                    <h3>Select or create a note</h3>
                    <p>Create your first {page === 'meetings' ? 'meeting note' : 'scratchpad'}.</p>
                  </div>
                ) : (
                  filtered.map((n) => (
                    <button
                      className={'note-list-item ' + (selected === n.id ? 'selected' : '')}
                      key={n.id}
                      onClick={() => open(n)}
                    >
                      <span>
                        {n.kind === 'meeting' ? <Mic size={15} /> : <FileText size={15} />}{' '}
                        {new Date(n.createdAt).toLocaleDateString(undefined, {
                          day: 'numeric',
                          month: 'short',
                        })}
                        {n.duration > 0 && ' · ' + stamp(n.duration)}
                      </span>
                      <strong>
                        {noteDetails(n).starred ? '★ ' : ''}
                        {n.title}
                      </strong>
                      <p>{n.body || n.summary || n.segments[0]?.text || 'Room for your thoughts…'}</p>
                      {!!noteFolders(n).length && (
                        <small>
                          <FolderOpen size={12} />
                          {noteFolders(n).join(' · ')}
                        </small>
                      )}
                      {n.status === 'interrupted' && <em>Interrupted · captured chunks kept</em>}
                    </button>
                  ))
                )}
              </aside>
              {draft ? (
                <section className="card note-editor">
                  <div className="note-editor-head">
                    <input
                      aria-label="Note title"
                      value={draft.title}
                      maxLength={300}
                      onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    />
                    <div className="inline-actions wrap">
                      <span className={'save-indicator ' + (dirty ? 'unsaved' : '')}>
                        {dirty ? 'Unsaved edits' : 'Saved'}
                      </span>
                      <button
                        className="button primary"
                        disabled={!!busy || !dirty}
                        onClick={() => void run('save', saveDraft)}
                      >
                        <Check size={14} />
                        Save
                      </button>
                      <button
                        className="icon-button"
                        aria-label="Export this note"
                        onClick={() =>
                          void run('export', async () => {
                            if (native) await runtime('export.check');
                            download('Aeka-Scribe-' + draft.id + '.md', exportNote(draft));
                          })
                        }
                      >
                        <Download size={16} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label="Move this note to trash"
                        disabled={recorder.active || !!busy || queue.some((q) => q.noteId === draft.id)}
                        onClick={() => {
                          if (
                            confirm(
                              'Move this note to trash? You can restore it for 30 days. Unsaved edits are included.',
                            )
                          )
                            void run('delete', async () => {
                              const saved = await saveDraft();
                              if (!saved) return;
                              await runtime('notes.save', {
                                note: { ...saved, details: { ...noteDetails(saved), trashedAt: Date.now() } },
                                baseUpdatedAt: saved.updatedAt,
                              });
                              setDraft(null);
                              setBase(null);
                              setSelected('');
                              await load();
                            });
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <label className="folder-field">
                    <FolderOpen size={14} />
                    <input
                      aria-label="Note folder"
                      list="note-folders"
                      placeholder="Add to a folder"
                      maxLength={100}
                      value={draft.folder}
                      onChange={(e) => setDraft({ ...draft, folder: e.target.value })}
                    />
                    <datalist id="note-folders">
                      {folders.map((f) => (
                        <option key={f}>{f}</option>
                      ))}
                    </datalist>
                  </label>
                  <label className="note-label" htmlFor="meeting-own-notes">
                    YOUR NOTES
                  </label>
                  <textarea
                    id="meeting-own-notes"
                    className="note-writing"
                    placeholder="Capture what stands out. Your own words stay separate from the AI summary."
                    value={draft.body}
                    maxLength={200000}
                    onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  />
                  <div className="note-section-title">
                    <h3>
                      <Sparkles size={15} />
                      Summary & actions
                    </h3>
                  </div>
                  <textarea
                    className="note-summary"
                    aria-label="Meeting summary"
                    placeholder={
                      configured
                        ? 'A summary appears here after you generate it. Review owners, amounts and dates.'
                        : 'Connect OpenAI to generate summaries. You can still write your own.'
                    }
                    value={draft.summary}
                    maxLength={100000}
                    onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
                  />
                  {draft.kind === 'meeting' && (
                    <>
                      <div className="note-section-title">
                        <h3>
                          <AudioGlyph />
                          Transcript <span>{draft.segments.length} segments</span>
                        </h3>
                        <button
                          className="button ghost"
                          disabled={recorder.active || props.dictationBusy || !consent}
                          onClick={() => void run('record', () => startMeeting(draft))}
                        >
                          <Mic size={14} />
                          Resume recording
                        </button>
                      </div>
                      {!draft.segments.length ? (
                        <p className="empty-inline">
                          Transcribed audio appears here in saved segments, usually after 8–20 seconds plus
                          processing time.
                        </p>
                      ) : (
                        <TranscriptEditor
                          note={draft}
                          onChange={changeDraft}
                          locked={recorder.active || queue.some((q) => q.noteId === draft.id)}
                        />
                      )}
                      <p className="small-print">
                        Optional cloud speaker separation can be enabled for meeting chunks in Desktop
                        settings. Labels are scoped to each chunk and need review. Imported audio can also use
                        speaker separation below.
                      </p>
                      {native && (
                        <DiarizedImport
                          note={draft}
                          onDone={() => void load()}
                          disabled={recorder.active || !!busy}
                          notify={notify}
                        />
                      )}
                    </>
                  )}
                  <NoteStudio
                    key={draft.id}
                    note={draft}
                    config={studio.config}
                    onChange={changeDraft}
                    onSave={saveDraft}
                    onOpen={openId}
                    configured={configured}
                    locked={recorder.active || queue.some((q) => q.noteId === draft.id)}
                    notify={notify}
                  />
                </section>
              ) : (
                <div className="note-detail-empty">
                  <FileText size={40} />
                  <h3>No notes yet</h3>
                  <p>Choose a note, or start with a blank page.</p>
                </div>
              )}
            </div>
          </>
        )}
        {page === 'ask' && (
          <MeetingChat
            key={JSON.stringify(chatScope)}
            notes={activeNotes}
            configured={configured}
            initialScope={chatScope}
            onOpen={openId}
            notify={notify}
          />
        )}
        {page === 'people' && (
          <PeoplePanel
            notes={activeNotes}
            onOpen={openId}
            onAsk={(scope) => {
              setChatScope(scope);
              onNavigate('ask');
            }}
          />
        )}
        {page === 'recipes' && <StudioSettings notify={notify} />}
        {page === 'trash' && <TrashPanel notes={notes} onRefresh={load} notify={notify} />}
        {page === 'transforms' && (
          <>
            <section className="card transform-controls">
              <div>
                <h2>Transform Text</h2>
                <p>Review an AI edit beside the original. Changes to numbers or negation are flagged.</p>
              </div>
              <label className="field">
                <span>Transform</span>
                <select value={instruction} onChange={(e) => setInstruction(e.target.value)}>
                  {[
                    'Polish grammar and punctuation while preserving my voice.',
                    'Make this concise without losing facts.',
                    'Format this as a professional email.',
                    'Turn this into clear bullet points.',
                    'Improve this as an AI prompt; do not invent requirements.',
                    'Apply only explicitly spoken self-corrections.',
                    'Translate this into English, preserving facts and names.',
                    'Translate this into Hindi, preserving facts and names.',
                  ].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                  {customTransforms.map((t, i) => (
                    <option key={'custom' + i} value={t}>
                      {'Custom ' + (i + 1) + ': ' + t.slice(0, 70)}
                    </option>
                  ))}
                  <option value="">Custom instruction</option>
                </select>
              </label>
              <label className="field">
                <span>Editing instruction</span>
                <textarea
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  maxLength={4000}
                  rows={2}
                />
              </label>
              <div className="inline-actions wrap">
                <button
                  className="button primary"
                  disabled={!configured || !!busy || !transformText.trim() || !instruction.trim()}
                  onClick={() =>
                    void run('transform', async () => {
                      const r = await runtime('ai', {
                        kind: 'transform',
                        noteIds: [],
                        text: transformText,
                        instruction,
                      });
                      setTransformed(r.text);
                    })
                  }
                >
                  <Sparkles size={16} />
                  {busy === 'transform' ? 'Editing…' : 'Transform text'}
                </button>
                <button
                  className="button ghost"
                  disabled={
                    !instruction.trim() ||
                    customTransforms.includes(instruction) ||
                    customTransforms.length >= 8
                  }
                  onClick={() =>
                    void run('save-transform', async () => {
                      const list = [...customTransforms, instruction];
                      if (native) {
                        const status = await runtime('status');
                        await runtime('settings.save', { ...status.settings, customTransforms: list });
                      } else localStorage.setItem('flow-transforms', JSON.stringify(list));
                      setCustomTransforms(list);
                      notify('Custom transform saved');
                    })
                  }
                >
                  Save custom transform ({customTransforms.length}/8)
                </button>
                <button
                  className="button ghost"
                  disabled={!transformed}
                  onClick={() => {
                    setUndo(transformText);
                    setTransformText(transformed);
                    setTransformed('');
                  }}
                >
                  Use revised text
                </button>
                <button
                  className="button ghost"
                  disabled={!undo}
                  onClick={() => {
                    setTransformText(undo);
                    setUndo('');
                  }}
                >
                  <Undo2 size={15} />
                  Undo
                </button>
              </div>
              {!configured && (
                <p className="small-print">
                  An OpenAI connection is required. Original text stays intact until you choose Use revised
                  text.
                </p>
              )}
            </section>
            <div className="editor-card transform-editor">
              <div className="editor-grid">
                <div className="editor-pane">
                  <label className="pane-label" htmlFor="transform-original">
                    ORIGINAL
                  </label>
                  <textarea
                    id="transform-original"
                    value={transformText}
                    maxLength={150000}
                    onChange={(e) => setTransformText(e.target.value)}
                    placeholder="Paste text, or use the Windows command shortcut to bring in selected text…"
                  />
                </div>
                <div className="editor-pane">
                  <label className="pane-label" htmlFor="transform-revised">
                    REVISED · REVIEW BEFORE USE
                  </label>
                  <textarea
                    id="transform-revised"
                    value={transformed}
                    maxLength={150000}
                    onChange={(e) => setTransformed(e.target.value)}
                    placeholder="Your reviewed revision goes here."
                  />
                </div>
              </div>
              {!!transformed && reviewChanges(transformText, transformed) && (
                <div className="review-warning">
                  <ShieldCheck size={15} />
                  Numbers or negation changed. Check the original before using this revision.
                </div>
              )}
              <div className="editor-actions">
                <span className="small-print">Original and revised text are kept separately.</span>
                <button
                  className="button secondary"
                  disabled={!transformed}
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(transformed)
                      .then(() => notify('Revised text copied'))
                      .catch(() => notify('Select the text and copy it manually.'))
                  }
                >
                  <Copy size={15} />
                  Copy revision
                </button>
              </div>
            </div>
          </>
        )}
        {page === 'team' && (
          <TeamPanel
            notes={activeNotes}
            resources={{ terms: props.terms, snippets: props.snippets }}
            onImport={props.onImportResources}
            notify={notify}
          />
        )}
        {page === 'desktop' && (
          <DesktopSettings
            native={native}
            notify={notify}
            onStatusChange={() => {
              props.onStatusChange();
              void runtime('status')
                .then((s) => setConfigured(s.openaiConfigured))
                .catch(() => {});
            }}
          />
        )}
      </div>
      {recorder.active && page !== 'meetings' && (
        <div className="floating-recorder meeting-floating">
          <Mic size={15} />
          {recorder.phase} · {stamp(recorder.elapsed)}
          <button onClick={() => onNavigate('meetings')}>Open meeting</button>
          <button onClick={() => void recorder.finish()}>Finish</button>
        </div>
      )}
      {countdown && (
        <div className="meeting-reminder" role="alertdialog" aria-label="Scheduled recording countdown">
          <h3>{countdown.title}</h3>
          <p>Recording starts in {Math.max(0, Math.ceil((countdown.deadline - clock) / 1000))} seconds.</p>
          <button
            className="button danger"
            onClick={() =>
              void run('cancel-schedule', async () => {
                await runtime('automation.cancel', { id: countdown.id });
                setCountdown(null);
              })
            }
          >
            Cancel automatic recording
          </button>
        </div>
      )}
      {(reminder || call) && !countdown && (
        <div className="meeting-reminder" role="dialog" aria-label="Meeting reminder">
          <CalendarDays size={24} />
          <h3>{reminder?.title || 'Possible meeting detected'}</h3>
          <p>
            {reminder
              ? 'Your scheduled meeting is coming up.'
              : `A ${call} window looks like a meeting. Confirm before recording.`}
          </p>
          <div className="inline-actions wrap">
            {reminder?.url && (
              <button
                className="button primary"
                onClick={() =>
                  void run('join', async () => {
                    await runtime('calendar.join', { id: reminder.id });
                    setReminder(null);
                  })
                }
              >
                Join call
              </button>
            )}
            <button
              className="button secondary"
              onClick={() => {
                onNavigate('meetings');
                setReminder(null);
                setCall('');
              }}
            >
              Recording controls
            </button>
            {reminder && (
              <button
                className="button ghost"
                onClick={() => {
                  const e = reminder;
                  setReminder(null);
                  setTimeout(() => setReminder(e), 300000);
                }}
              >
                Snooze 5 min
              </button>
            )}
            <button
              className="button ghost"
              onClick={() => {
                setReminder(null);
                setCall('');
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </>
  );
}
function AudioGlyph() {
  return (
    <span className="audio-glyph" aria-hidden="true">
      {[9, 18, 28, 15, 24, 12].map((n, i) => (
        <i key={i} style={{ height: n }} />
      ))}
    </span>
  );
}
function DiarizedImport({
  note,
  onDone,
  disabled,
  notify,
}: {
  note: Note;
  onDone: () => void;
  disabled: boolean;
  notify: (s: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null),
    [working, setWorking] = useState(false);
  return (
    <div className="audio-import">
      <button
        className="button secondary"
        disabled={disabled || working}
        onClick={() => input.current?.click()}
      >
        {working ? 'Separating speakers…' : 'Import audio with speaker labels'}
      </button>
      <small>Up to 20 MB. Separate imports keep distinct speaker IDs. This adds to the transcript.</small>
      <input
        hidden
        ref={input}
        type="file"
        accept=".wav,.webm,.m4a,.mp3,.mp4"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          if (file.size > 20 * 1024 * 1024) {
            notify('Choose a file under 20 MB.');
            return;
          }
          setWorking(true);
          try {
            const r = await runtime('transcribe', {
              audioBuffer: await file.arrayBuffer(),
              filename: file.name,
              mime: file.type,
              diarize: true,
            });
            const all = (await runtime('notes.list')) as Note[],
              latest = all.find((n) => n.id === note.id);
            if (!latest) throw Error('Note no longer exists.');
            const prefix = newId();
            const segments = (
              r.segments.length ? r.segments : [{ text: r.text, start: 0, end: 0, speaker: '' }]
            ).map((s: any, i: number) => ({
              id: prefix + '_' + i,
              text: s.text,
              start: latest.duration + s.start,
              end: latest.duration + s.end,
              speaker: s.speaker ? prefix.slice(0, 6) + ' ' + s.speaker : '',
            }));
            await runtime('notes.save', {
              note: {
                ...latest,
                segments: [...latest.segments, ...segments],
                duration: Math.max(latest.duration, ...segments.map((s: any) => s.end)),
              },
              baseUpdatedAt: latest.updatedAt,
            });
            onDone();
            notify('Speaker transcript imported. Review and name the speakers.');
          } catch (err) {
            notify(err instanceof Error ? err.message : 'Import failed.');
          } finally {
            setWorking(false);
          }
        }}
      />
    </div>
  );
}

function DesktopSettings({
  native,
  notify,
  onStatusChange,
}: {
  native: boolean;
  notify: (s: string) => void;
  onStatusChange: () => void;
}) {
  const [settings, setSettings] = useState<any>(null),
    [key, setKey] = useState(''),
    [configured, setConfigured] = useState(false),
    [calendar, setCalendar] = useState<any[]>([]),
    [provider, setProvider] = useState('google'),
    [clientId, setClientId] = useState(''),
    [secret, setSecret] = useState(''),
    [password, setPassword] = useState(''),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [processName, setProcessName] = useState(''),
    [appStyle, setAppStyle] = useState('clean');
  const load = async () => {
    if (!native) return;
    const [s, c] = await Promise.all([runtime('status'), runtime('calendar.status')]);
    setSettings(s.settings);
    setConfigured(s.openaiConfigured);
    setCalendar(c);
    if (s.shortcutErrors?.length)
      setError('These shortcuts are already in use: ' + s.shortcutErrors.join(', '));
  };
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [native]);
  const run = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'This action could not finish.');
    } finally {
      setBusy('');
    }
  };
  const save = () =>
    run('settings', async () => {
      const result = await runtime('settings.save', settings);
      setSettings(result);
      notify(
        result.shortcutErrors?.length
          ? 'Saved, but a shortcut is unavailable. Choose another combination.'
          : 'Desktop settings saved',
      );
    });
  const backup = (action: string) =>
    run(action, async () => {
      const result = await runtime(action, { password });
      if (!result.cancelled)
        notify(
          result.conflicts !== undefined
            ? `${result.added} notes imported; ${result.conflicts} conflicting notes preserved as separate copies.`
            : 'Encrypted snapshot saved',
        );
      setPassword('');
    });
  if (!native)
    return (
      <div className="settings-stack">
        <section className="desktop-intro card">
          <Monitor size={35} />
          <h2>Aeka Scribe for Windows</h2>
          <p>
            The Windows package adds global dictation shortcuts, a tray and recording overlay, text insertion,
            microphone + system audio, calendar sign-in, reminders and encrypted local notes.
          </p>
          <div className="capability-chips">
            {[
              'Windows 10 / 11 · x64',
              'Google & Outlook OAuth',
              'Local audio recovery',
              'Meeting notes & Ask',
            ].map((x) => (
              <span key={x}>{x}</span>
            ))}
          </div>
          <p>
            Download the Windows package attached to this conversation, extract the full folder, and open{' '}
            <strong>Aeka Scribe.exe</strong>. Open Desktop settings in that app to connect your accounts.
          </p>
          <a href="/desktop-guide.html" className="button secondary" target="_blank" rel="noreferrer">
            Setup & feature status <ArrowUpRight size={15} />
          </a>
          <p className="small-print">
            The package is unsigned and has not been tested on a real Windows microphone or call. The web
            workspace remains available here. Desktop notes stay in its encrypted local vault; web notes are
            saved to your signed-in account. Enable continuous sync in Desktop settings to connect them. Raw
            audio, credentials and dictation history remain on their original device.
          </p>
        </section>
        <section className="card form-card">
          <h2>Your connections</h2>
          <p>
            Google Calendar is connected to ChatGPT. The hosted workspace cannot use that connection until
            Sites calendar eligibility is available. The standalone app uses separate, explicit Google or
            Microsoft sign-in.
          </p>
          <p className="small-print">
            Joining opens the meeting’s supported web link. Your browser or calling app handles its own login.
            Aeka Scribe does not sign in to calls or admit itself as a meeting bot.
          </p>
        </section>
      </div>
    );
  if (!settings) return <div className="notice">{error || 'Loading encrypted desktop settings…'}</div>;
  const bools = [
    ['launchAtLogin', 'Launch when I sign in to Windows'],
    ['autoPaste', 'Insert completed dictation into the original field'],
    ['holdToTalk', 'Hold F8 to dictate; release F8 to finish'],
    ['captureSelection', 'Allow the command shortcut to read selected text'],
    ['reminders', 'Show calendar reminders'],
    ['callDetection', 'Suggest recording when a meeting window is detected'],
    ['retainAudio', 'Keep successfully transcribed meeting audio on this device'],
  ] as const;
  return (
    <div className="settings-stack">
      {error && (
        <div className="notice warning" role="alert">
          {error}
        </div>
      )}
      <section className="card settings-card">
        <div className="settings-title">
          <ShieldCheck size={23} />
          <div>
            <h2>AI connection</h2>
            <p>Your API key is encrypted for your Windows account.</p>
          </div>
        </div>
        <div className="settings-body">
          <p>
            {configured
              ? 'OpenAI key saved. Requests will verify it with the provider.'
              : 'Add your own OpenAI API key. Recording and handwritten notes work before you connect.'}
          </p>
          <label className="field">
            <span>OpenAI API key</span>
            <input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-…"
              maxLength={600}
            />
          </label>
          <div className="inline-actions wrap">
            <button
              className="button primary"
              disabled={!key || !!busy}
              onClick={() =>
                void run('key', async () => {
                  await runtime('credentials.save', { key });
                  setKey('');
                  await load();
                  onStatusChange();
                  notify('Key encrypted and saved');
                })
              }
            >
              Save key
            </button>
            <button className="button ghost" onClick={() => void runtime('help.open', { topic: 'openai' })}>
              Get an API key <ArrowUpRight size={14} />
            </button>
            {configured && (
              <button
                className="button ghost"
                onClick={() => {
                  if (confirm('Remove the saved OpenAI key?'))
                    void run('remove-key', async () => {
                      await runtime('credentials.save', { key: '' });
                      await load();
                      onStatusChange();
                    });
                }}
              >
                Remove key
              </button>
            )}
          </div>
          <label className="field">
            <span>Text model for summaries, Ask and transforms</span>
            <input
              value={settings.textModel}
              maxLength={100}
              onChange={(e) => setSettings({ ...settings, textModel: e.target.value })}
            />
          </label>
          <p className="small-print">
            Speech: gpt-transcribe. Imported speaker transcripts: gpt-4o-transcribe-diarize. Audio and
            selected text go to OpenAI only for requested AI processing. API billing and provider retention
            are separate.
          </p>
        </div>
      </section>
      <section className="card settings-card">
        <div className="settings-title">
          <CalendarDays size={23} />
          <div>
            <h2>Calendars</h2>
            <p>Read upcoming events and open their meeting links.</p>
          </div>
        </div>
        <div className="settings-body">
          {calendar.map((c) => (
            <div className="connection-box" key={c.provider}>
              <span className={'status-dot ' + (c.connected ? 'green' : '')} />
              <div>
                <strong>{c.provider === 'google' ? 'Google Calendar' : 'Microsoft Outlook'}</strong>
                <p>{c.connected ? c.email || 'Connected' : 'Not connected'}</p>
              </div>
              <button
                className="button ghost"
                disabled={!!busy}
                onClick={() =>
                  void run('calendar', async () => {
                    await runtime(c.connected ? 'calendar.disconnect' : 'calendar.connect', {
                      provider: c.provider,
                    });
                    await load();
                    notify(c.connected ? 'Calendar disconnected' : 'Calendar connected');
                  })
                }
              >
                {c.connected ? 'Disconnect' : 'Connect'}
              </button>
            </div>
          ))}
          <details>
            <summary>Calendar app registration</summary>
            <p className="small-print">
              This independent build needs a public desktop OAuth client registration. It requests read-only
              calendar access. Microsoft must allow personal/organizational accounts and a loopback redirect.
              Google must use a Desktop app client. Your account grants consent in your system browser.
            </p>
            <label className="field">
              <span>Provider</span>
              <select
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value);
                  setClientId(calendar.find((c) => c.provider === e.target.value)?.clientId || '');
                  setSecret('');
                }}
              >
                <option value="google">Google</option>
                <option value="microsoft">Microsoft</option>
              </select>
            </label>
            <label className="field">
              <span>Desktop client ID</span>
              <input
                value={clientId}
                maxLength={300}
                onChange={(e) => setClientId(e.target.value)}
                autoComplete="off"
              />
            </label>
            {provider === 'google' && (
              <label className="field">
                <span>Client secret from desktop registration, if provided</span>
                <input
                  type="password"
                  value={secret}
                  maxLength={500}
                  onChange={(e) => setSecret(e.target.value)}
                  autoComplete="off"
                />
              </label>
            )}
            <div className="inline-actions wrap">
              <button
                className="button secondary"
                disabled={!clientId || !!busy}
                onClick={() =>
                  void run('config', async () => {
                    await runtime('calendar.config', {
                      provider,
                      clientId,
                      ...(secret ? { clientSecret: secret } : {}),
                    });
                    setSecret('');
                    await load();
                    notify('Calendar registration saved. Choose Connect above.');
                  })
                }
              >
                Save registration
              </button>
              <button className="button ghost" onClick={() => void runtime('help.open', { topic: provider })}>
                Registration guide <ArrowUpRight size={14} />
              </button>
            </div>
          </details>
          <p className="small-print">
            Aeka Scribe opens your meeting link. Your calling app handles login, admission, microphone and
            camera permissions. Aeka Scribe does not join as a bot.
          </p>
        </div>
      </section>
      <section className="card settings-card">
        <div className="settings-title">
          <Settings2 size={23} />
          <div>
            <h2>Desktop controls</h2>
            <p>Keep dictation within reach.</p>
          </div>
        </div>
        <div className="settings-body">
          {bools.map(([k, l]) => (
            <label className="toggle-row" key={k}>
              <span>
                <strong>{l}</strong>
              </span>
              <input
                type="checkbox"
                checked={settings[k]}
                onChange={(e) => setSettings({ ...settings, [k]: e.target.checked })}
              />
            </label>
          ))}
          {[
            ['shortcut', 'Start / finish dictation'],
            ['cancelShortcut', 'Cancel dictation'],
            ['pasteShortcut', 'Paste last dictation'],
            ['commandShortcut', 'Transform selected text'],
          ].map(([k, l]) => (
            <label className="field" key={k}>
              <span>{l}</span>
              <input
                value={settings[k]}
                maxLength={80}
                onChange={(e) => setSettings({ ...settings, [k]: e.target.value })}
              />
            </label>
          ))}
          <label className="field">
            <span>Reminder lead time</span>
            <select
              value={settings.reminderMinutes}
              onChange={(e) => setSettings({ ...settings, reminderMinutes: Number(e.target.value) })}
            >
              {[0, 1, 2, 5, 10].map((n) => (
                <option value={n} key={n}>
                  {n ? `${n} minutes before` : 'At start time'}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Apps excluded from automatic insertion (process names, comma separated)</span>
            <input
              value={settings.excludedApps.join(', ')}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  excludedApps: e.target.value
                    .split(',')
                    .map((x) => x.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
          <p className="small-print">
            Insertion checks the original foreground field and refuses password or unreadable fields. Windows
            may block insertion into elevated apps. Meeting detection is a window-title heuristic. Separately,
            you can explicitly schedule automatic recordings from the Meetings page.
          </p>
        </div>
      </section>
      <section className="card settings-card">
        <div className="settings-title">
          <FileText size={23} />
          <div>
            <h2>Style by app</h2>
            <p>Choose local cleanup for each Windows application.</p>
          </div>
        </div>
        <div className="settings-body">
          {settings.appStyles.map((r: any, i: number) => (
            <div className="app-style-row" key={i}>
              <strong>{r.process}</strong>
              <span>{r.style}</span>
              <button
                className="icon-button"
                aria-label={'Remove style for ' + r.process}
                onClick={() =>
                  setSettings({
                    ...settings,
                    appStyles: settings.appStyles.filter((_: any, j: number) => j !== i),
                  })
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <label className="field">
            <span>Process name, e.g. WINWORD or OUTLOOK</span>
            <input value={processName} maxLength={100} onChange={(e) => setProcessName(e.target.value)} />
          </label>
          <select
            aria-label="Cleanup style for app"
            value={appStyle}
            onChange={(e) => setAppStyle(e.target.value)}
          >
            {['verbatim', 'clean', 'sentences', 'notes'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button
            className="button secondary"
            disabled={!processName.trim() || settings.appStyles.length >= 50}
            onClick={() => {
              setSettings({
                ...settings,
                appStyles: [
                  ...settings.appStyles.filter(
                    (r: any) => r.process.toLowerCase() !== processName.toLowerCase(),
                  ),
                  { process: processName.trim(), style: appStyle },
                ],
              });
              setProcessName('');
            }}
          >
            Add app style
          </button>
        </div>
      </section>
      <DesktopConnections />
      <DesktopAdvanced settings={settings} setSettings={setSettings} onStatusChange={onStatusChange} />
      <div className="desktop-save">
        <button className="button primary" disabled={!!busy} onClick={() => void save()}>
          <Check size={16} />
          Save desktop preferences
        </button>
      </div>
      <section className="card settings-card">
        <div className="settings-title">
          <FolderOpen size={23} />
          <div>
            <h2>Portable backup & sync folder</h2>
            <p>Move notes between your Windows computers.</p>
          </div>
        </div>
        <div className="settings-body">
          <p>
            Export or import a password-encrypted snapshot. A folder managed by OneDrive, Google Drive or
            Dropbox can transport it. Save and load snapshots explicitly; simultaneous edits are kept as
            separate copies.
          </p>
          <label className="field">
            <span>Snapshot password · at least 12 characters</span>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <div className="inline-actions wrap">
            <button
              className="button secondary"
              disabled={password.length < 12 || !!busy}
              onClick={() => void backup('backup.export')}
            >
              Export encrypted backup
            </button>
            <button
              className="button secondary"
              disabled={password.length < 12 || !!busy}
              onClick={() => void backup('backup.import')}
            >
              Import backup
            </button>
            <button
              className="button ghost"
              disabled={!!busy}
              onClick={() =>
                void run('folder', async () => {
                  const r = await runtime('sync.folder');
                  if (r.selected) notify('Sync folder selected');
                })
              }
            >
              Choose synced folder
            </button>
            <button
              className="button ghost"
              disabled={password.length < 12 || !!busy}
              onClick={() => void backup('sync.save')}
            >
              Save snapshot to folder
            </button>
            <button
              className="button ghost"
              disabled={password.length < 12 || !!busy}
              onClick={() => void backup('sync.load')}
            >
              Load snapshot from folder
            </button>
          </div>
          <p className="small-print">
            Snapshots contain notes, dictation profile and preferences. They exclude API keys, calendar tokens
            and raw audio. Keep the password safe; it cannot be recovered. Importing restores the dictation
            profile after restarting Aeka Scribe.
          </p>
          <button
            className="button danger"
            disabled={!!busy}
            onClick={() => {
              if (
                confirm(
                  'Permanently delete all retained and pending meeting audio? Pending speech will no longer be transcribed.',
                )
              )
                void run('clear', async () => {
                  await runtime('audio.clear');
                  notify('Local meeting audio removed');
                });
            }}
          >
            Delete all meeting audio
          </button>
        </div>
      </section>
    </div>
  );
}
