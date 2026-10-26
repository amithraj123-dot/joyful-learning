'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  Mic,
  Square,
  Copy,
  Check,
  History,
  BookOpen,
  Settings2,
  FileText,
  Download,
  Upload,
  Trash2,
  Search,
  Plus,
  RotateCcw,
  Clock3,
  ArrowRight,
  ShieldCheck,
  SlidersHorizontal,
  X,
  Sparkles,
  Headphones,
  ArrowUpRight,
  CalendarDays,
  StickyNote,
  MessageCircle,
  WandSparkles,
  Monitor,
} from 'lucide-react';
import {
  defaults,
  seedTerms,
  seedSnippets,
  formatText,
  pruneHistory,
  wordCount,
  reviewChanges,
  validateBackup,
  newId,
  type Settings,
  type Term,
  type Snippet,
  type Entry,
  type Style,
} from '../lib/scribe-core';
import { useRecorder } from '../hooks/use-recorder';
import { isDesktop, runtime } from '../lib/desktop-runtime';
import { WorkspacePanel } from '../components/workspace-panel';
import { findPage, modulesFor } from '../core/client/registry';
// Page ids come from module manifests (core/client/registry.ts); Scribe ids are unprefixed.
type Page = string;
const STORAGE = 'aeka-scribe-workspace-v2',
  LEGACY_STORAGE = 'flow-workspace-v2'; // read once from releases before the rename
const languages = [
  ['en-IN', 'English · India'],
  ['en-US', 'English · US'],
  ['en-GB', 'English · UK'],
  ['hi-IN', 'Hindi'],
  ['kn-IN', 'Kannada'],
  ['ta-IN', 'Tamil'],
  ['te-IN', 'Telugu'],
  ['mr-IN', 'Marathi'],
];
const styleLabels: Record<Style, string> = {
  verbatim: 'Verbatim',
  clean: 'Clean',
  sentences: 'Sentences',
  notes: 'Notes',
};
function download(name: string, text: string, type = 'text/plain') {
  const save = () => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  if (isDesktop())
    void runtime('export.check')
      .then(save)
      .catch((e) => alert(e.message));
  else save();
}
function duration(seconds: number) {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`;
}
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export default function AekaScribe() {
  const [speechLabel, setSpeechLabel] = useState('gpt-transcribe');
  const [native, setNative] = useState(false),
    [meetingBusy, setMeetingBusy] = useState(false);
  const nativeInsert = useRef(false),
    captureStyle = useRef<Style | null>(null);
  const [page, setPage] = useState<Page>('studio'),
    [settings, setSettings] = useState<Settings>(defaults),
    [terms, setTerms] = useState<Term[]>(seedTerms),
    [snippets, setSnippets] = useState<Snippet[]>(seedSnippets),
    [history, setHistory] = useState<Entry[]>([]),
    [loaded, setLoaded] = useState(false),
    [storageError, setStorageError] = useState('');
  const [raw, setRaw] = useState(''),
    [result, setResult] = useState(''),
    [changes, setChanges] = useState<string[]>([]),
    [search, setSearch] = useState(''),
    [toast, setToast] = useState(''),
    [copied, setCopied] = useState(false),
    [configured, setConfigured] = useState<boolean | null>(null),
    [statusError, setStatusError] = useState(false),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [minutes, setMinutes] = useState(600),
    [editTerm, setEditTerm] = useState<Term | null>(null),
    [editSnippet, setEditSnippet] = useState<Snippet | null>(null),
    [termPhrase, setTermPhrase] = useState(''),
    [termReplacement, setTermReplacement] = useState(''),
    [snippetTrigger, setSnippetTrigger] = useState(''),
    [snippetText, setSnippetText] = useState('');
  const draft = useRef<{ id: string; createdAt: number; engine: string; duration: number } | null>(null),
    restoreFile = useRef<HTMLInputElement>(null),
    audioFile = useRef<HTMLInputElement>(null);
  const notify = (message: string) => setToast(message);
  const apply = (text = raw, opts = settings) => {
    const formatted = formatText(text, opts, terms, snippets);
    setResult(formatted.text);
    setChanges(formatted.changes);
    return formatted.text;
  };
  const saveEntry = (text: string, original: string, meta = draft.current) => {
    if (settings.retention === 0) {
      notify('History is off. Export or copy this text to keep it.');
      return;
    }
    if (!text.trim()) return;
    const base = meta ?? { id: newId(), createdAt: Date.now(), engine: 'Text editor', duration: 0 };
    draft.current = base;
    const entry = { ...base, raw: original, text, style: settings.style };
    setHistory((old) => pruneHistory([entry, ...old.filter((e) => e.id !== entry.id)], settings.retention));
  };
  const recorder = useRecorder(({ text, duration: seconds, engine }) => {
    setRaw(text);
    const formatted = apply(
      text,
      captureStyle.current ? { ...settings, style: captureStyle.current } : settings,
    );
    draft.current = { id: newId(), createdAt: Date.now(), engine, duration: seconds };
    if (settings.retention !== 0) saveEntry(formatted, text, draft.current);
    if (nativeInsert.current) {
      nativeInsert.current = false;
      void runtime('dictation.complete', { text: formatted }).catch((e) => notify(e.message));
    }
    captureStyle.current = null;
  });
  useEffect(() => {
    let alive = true;
    setNative(isDesktop());
    void (async () => {
      try {
        const saved = isDesktop()
          ? await runtime('profile.get')
          : JSON.parse(localStorage.getItem(STORAGE) || localStorage.getItem(LEGACY_STORAGE) || 'null');
        if (!alive) return;
        if (saved) {
          const data = validateBackup(saved);
          if (data) {
            setSettings({ ...data.settings, ...(isDesktop() ? { engine: 'openai' as const } : {}) });
            setTerms(data.terms);
            setSnippets(data.snippets);
            setHistory(data.history);
          } else setStorageError('Saved data could not be read. Export a backup before changing it.');
        } else if (isDesktop()) setSettings({ ...defaults, engine: 'openai' });
      } catch {
        if (alive) setStorageError('Saved data could not be read. Export a backup before changing it.');
      }
      if (alive) setLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!loaded || storageError) return;
    const value = {
      version: 2,
      settings,
      terms,
      snippets,
      history: pruneHistory(history, settings.retention),
    };
    if (isDesktop()) {
      void runtime('profile.save', value).catch(() =>
        setStorageError('The encrypted profile could not be saved. Export a backup.'),
      );
    } else {
      try {
        localStorage.setItem(STORAGE, JSON.stringify(value));
      } catch {
        setStorageError('Browser storage is full or unavailable. Export a backup.');
      }
    }
  }, [loaded, settings, terms, snippets, history, storageError]);
  useEffect(() => {
    if (!loaded) return;
    const trim = () => setHistory((old) => pruneHistory(old, settings.retention));
    trim();
    const id = setInterval(trim, 60000);
    return () => clearInterval(id);
  }, [settings.retention, loaded]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(id);
  }, [toast]);
  const refreshStatus = () => {
    setStatusError(false);
    void runtime('status')
      .then((d) => {
        setConfigured(!!(d.speechConfigured ?? d.openaiConfigured));
        setSpeechLabel(d.settings?.asrEngine === 'local' ? 'Local Whisper' : 'gpt-transcribe');
      })
      .catch(() => {
        setConfigured(null);
        setStatusError(true);
      });
  };
  useEffect(() => {
    refreshStatus();
  }, []);
  const choosePage = (next: Page) => {
    setPage(next);
    setSearch('');
    try {
      localStorage.setItem('aeka-workspace-page', next);
    } catch {}
  };
  // Reopen the last page (web only: the desktop always opens on dictation).
  useEffect(() => {
    if (isDesktop()) return;
    try {
      // A link such as /?page=mail/connect (for example after Outlook sign-in) opens that page once.
      const url = new URL(window.location.href);
      const wanted = url.searchParams.get('page');
      if (wanted) {
        url.searchParams.delete('page');
        window.history.replaceState(null, '', url.pathname + url.search + url.hash);
      }
      const last = wanted || localStorage.getItem('aeka-workspace-page');
      const found = last && findPage(last);
      if (found && found.module.surfaces.includes('web')) setPage(last);
    } catch {}
  }, []);
  const start = (style?: Style) => {
    if (meetingBusy) {
      notify('Finish the meeting before starting dictation.');
      return;
    }
    captureStyle.current = style || null;
    if (settings.engine === 'openai' && !configured) {
      notify('Configure your selected speech engine in Desktop or Transcription settings first.');
      return;
    }
    void recorder.start(settings, terms);
  };
  const capturing = ['requesting', 'recording'].includes(recorder.state);
  const actions = useRef({
    start,
    stop: recorder.stop,
    cancel: recorder.cancel,
    busy: recorder.busy,
    capturing,
  });
  actions.current = { start, stop: recorder.stop, cancel: recorder.cancel, busy: recorder.busy, capturing };
  useEffect(() => {
    if (isDesktop()) return;
    const keydown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      // Escape cancels capture only. Once audio is being transcribed it must not be discarded by an
      // Escape meant for a menu, dialog or input method.
      const inField = (e.target as HTMLElement | null)?.closest?.('input,textarea,select,[role=dialog]');
      if (e.key === 'Escape' && actions.current.capturing && !inField) {
        e.preventDefault();
        actions.current.cancel();
      }
      if (e.ctrlKey && e.shiftKey && e.code === 'Space') {
        e.preventDefault();
        if (actions.current.busy) actions.current.stop();
        else actions.current.start();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, []);
  useEffect(() => {
    return window.aekaScribe?.on((e) => {
      if (e.type === 'dictation-start' && !actions.current.busy) {
        nativeInsert.current = true;
        actions.current.start(e.style as Style | undefined);
      }
      if (e.type === 'dictation-stop' || e.type === 'app-finish') actions.current.stop();
      if (e.type === 'dictation-cancel') {
        nativeInsert.current = false;
        actions.current.cancel();
      }
    });
  }, []);
  useEffect(() => {
    if (isDesktop())
      void runtime('recording.state', { kind: 'dictation', state: recorder.state }).catch(() => {});
  }, [recorder.state]);
  const copy = async (text = result) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      notify('Copied to clipboard');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      notify('Clipboard access was blocked. Select the text and copy it manually.');
    }
  };
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((old) => ({ ...old, [key]: value }));
  const reset = () => {
    if (recorder.busy) return;
    if (
      (raw || result) &&
      !confirm('Start a new draft? Save or export this draft first if you want to keep it.')
    )
      return;
    setRaw('');
    setResult('');
    setChanges([]);
    draft.current = null;
    recorder.cancel();
  };
  const demo = () => {
    if ((raw || result) && !confirm('Replace this draft with the example?')) return;
    const text =
      'um please review the GST reconciliation. The amount is 12,50,000 and not 15,00,000. Send the draft to aeka advisors.';
    setRaw(text);
    apply(text);
    draft.current = null;
    notify('Example loaded. Original text is preserved.');
  };
  const exportBackup = async () => {
    try {
      if (native) await runtime('export.check');
      download(
        'aeka-scribe-backup.json',
        JSON.stringify(
          { version: 2, settings, terms, snippets, history: pruneHistory(history, settings.retention) },
          null,
          2,
        ),
        'application/json',
      );
    } catch (e: any) {
      notify(e.message);
    }
  };
  const restore = async (file: File) => {
    try {
      if (file.size > 10 * 1024 * 1024) throw Error();
      const value = validateBackup(JSON.parse(await file.text()));
      if (!value) throw Error();
      if (
        !confirm(
          'Replace vocabulary, snippets, settings and history with this backup? Export your current workspace first if needed.',
        )
      )
        return;
      setTerms(value.terms);
      setSnippets(value.snippets);
      setSettings(value.settings);
      setHistory(value.history);
      setStorageError('');
      notify('Workspace restored');
    } catch {
      notify('This is not a valid Aeka Scribe workspace backup. Nothing was changed.');
    }
  };
  const getDevices = async () => {
    let mic: MediaStream | null = null;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      setDevices((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput'));
      notify('Microphones refreshed');
    } catch {
      notify('Allow microphone access to choose an input device.');
    } finally {
      mic?.getTracks().forEach((t) => t.stop());
    }
  };
  const addTerm = (e: React.FormEvent) => {
    e.preventDefault();
    const phrase = termPhrase.trim(),
      replacement = termReplacement.trim();
    if (!phrase || !replacement) return;
    if (terms.some((t) => t.id !== editTerm?.id && t.phrase.toLowerCase() === phrase.toLowerCase())) {
      notify('That phrase is already in your vocabulary.');
      return;
    }
    if (!editTerm && terms.length >= 500) {
      notify('Vocabulary is limited to 500 entries.');
      return;
    }
    setTerms((old) => [
      { id: editTerm?.id ?? newId(), phrase, replacement },
      ...old.filter((t) => t.id !== editTerm?.id),
    ]);
    setTermPhrase('');
    setTermReplacement('');
    setEditTerm(null);
    notify('Vocabulary saved');
  };
  const addSnippet = (e: React.FormEvent) => {
    e.preventDefault();
    const trigger = snippetTrigger.trim(),
      text = snippetText.trim();
    if (!trigger || !text) return;
    if (snippets.some((s) => s.id !== editSnippet?.id && s.trigger.toLowerCase() === trigger.toLowerCase())) {
      notify('That trigger is already in use.');
      return;
    }
    if (!editSnippet && snippets.length >= 200) {
      notify('Snippets are limited to 200 entries.');
      return;
    }
    setSnippets((old) => [
      { id: editSnippet?.id ?? newId(), trigger, text },
      ...old.filter((t) => t.id !== editSnippet?.id),
    ]);
    setSnippetTrigger('');
    setSnippetText('');
    setEditSnippet(null);
    notify('Snippet saved');
  };
  const filteredHistory = history.filter((e) =>
    (e.text + ' ' + e.raw).toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const totalWords = history.reduce((sum, e) => sum + wordCount(e.text), 0),
    historyMinutes = Math.round(history.reduce((sum, e) => sum + e.duration, 0) / 60);
  const warning = !!result && reviewChanges(raw, result),
    saved =
      !!draft.current &&
      history.some((e) => e.id === draft.current?.id && e.text === result && e.raw === raw);
  const surface = native ? 'desktop' : 'web';
  const current = findPage(page) ?? findPage('studio')!;
  const { title, subtitle } = current.page;
  const ModuleView = current.module.View;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          href="#"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            choosePage('studio');
          }}
          aria-label={native ? 'Aeka Scribe home' : 'Aeka Workspace home'}
        >
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-word">
            <b>aeka</b>
            <span>{native ? 'scribe' : 'workspace'}</span>
          </span>
        </a>
        <div className="workspace-tag">
          <span className="avatar">A</span>
          <div>
            <strong>{native ? 'Personal workspace' : 'Firm workspace'}</strong>
            <small>Aeka Advisors</small>
          </div>
        </div>
        <div className="nav-groups">
          {modulesFor(surface).map((mod) => (
            <div className="nav-group" key={mod.id}>
              <p className="nav-label">{mod.name.toUpperCase()}</p>
              <nav aria-label={mod.name}>
                {mod.pages
                  .filter((item) => !item.hidden)
                  .map((item) => (
                    <button
                      key={item.id}
                      title={item.label}
                      aria-label={item.label}
                      aria-current={page === item.id ? 'page' : undefined}
                      className={'nav-item ' + (page === item.id ? 'active' : '')}
                      onClick={() => choosePage(item.id)}
                    >
                      <item.icon size={19} />
                      {item.label}
                      {item.id === 'history' && history.length > 0 && (
                        <span className="nav-count">{history.length}</span>
                      )}
                    </button>
                  ))}
              </nav>
            </div>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="private-note">
            <ShieldCheck size={19} />
            <div>
              <strong>{native ? 'Encrypted on Windows' : 'A personal workspace'}</strong>
              <p>
                {native
                  ? 'Keys stay local. Note sync is optional.'
                  : 'Dictations stay here. Notes sync with your account.'}
              </p>
            </div>
          </div>
          <button
            aria-label="Settings"
            title="Settings"
            className={'nav-item ' + (page === 'settings' ? 'active' : '')}
            onClick={() => choosePage('settings')}
          >
            <Settings2 size={19} />
            Settings
          </button>
          <div className="version-line">
            <span>{native ? 'AEKA SCRIBE' : 'AEKA WORKSPACE'}</span>
            <span>0.7</span>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> <strong>{title}</strong>
          </div>
          {current.module.id === 'scribe' && (
            <button className="connection-pill" onClick={() => choosePage(native ? 'desktop' : 'settings')}>
              <span className={'status-dot ' + (configured ? 'green' : '')} />
              {configured ? 'AI configured' : native ? 'AI setup needed' : 'Browser mode'}
              <SlidersHorizontal size={14} />
            </button>
          )}
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">AEKA {current.module.name.toUpperCase()}</p>
              <h1>{title}</h1>
              <p className="subtitle">{subtitle}</p>
            </div>
            {page === 'studio' && (
              <button className="button secondary new-draft" onClick={reset} disabled={recorder.busy}>
                <Plus size={16} />
                New draft
              </button>
            )}
          </div>
          {storageError && (
            <div className="notice warning">
              <span>{storageError}</span>
              <button onClick={exportBackup}>Export backup</button>
            </div>
          )}
          {page === 'studio' && (
            <>
              <section className="capture-card">
                <div className="capture-top">
                  <div className="section-kicker">
                    <span className="live-dot" /> DICTATION STUDIO
                  </div>
                  <span className="quiet-label">
                    {settings.engine === 'browser'
                      ? 'Browser speech recognition'
                      : native
                        ? speechLabel
                        : 'OpenAI · gpt-transcribe'}
                  </span>
                </div>
                <div className={'capture-center ' + (recorder.state === 'recording' ? 'listening' : '')}>
                  <div className="wave" aria-hidden="true">
                    {[16, 28, 42, 58, 36, 68, 84, 52, 72, 40, 60, 82, 48, 66, 34, 50, 28, 16, 34, 52, 30].map(
                      (height, i) => (
                        <span
                          key={i}
                          style={{
                            height:
                              recorder.state === 'recording' && settings.engine === 'openai'
                                ? `${12 + height * recorder.level}px`
                                : `${height}px`,
                            animationDelay: `${i * 0.07}s`,
                          }}
                        />
                      ),
                    )}
                  </div>
                  <h2>
                    {recorder.state === 'recording'
                      ? 'Recording'
                      : recorder.state === 'requesting'
                        ? 'Waiting for microphone access'
                        : recorder.state === 'stopping'
                          ? 'Finalising the recording'
                          : recorder.state === 'transcribing'
                            ? 'Transcribing'
                            : 'Ready to dictate'}
                  </h2>
                  <p>
                    {recorder.state === 'recording'
                      ? `${duration(recorder.elapsed)} · Up to 5 minutes per recording`
                      : recorder.state === 'transcribing'
                        ? 'Keep this page open. You can cancel at any time.'
                        : 'Select the microphone to begin dictation'}
                  </p>
                  <div className="record-actions">
                    <button
                      className={'record-button ' + (recorder.state === 'recording' ? 'recording' : '')}
                      onClick={() => (recorder.busy ? recorder.stop() : start())}
                      disabled={
                        !loaded ||
                        ['stopping', 'transcribing'].includes(recorder.state) ||
                        (settings.engine === 'openai' && !configured)
                      }
                    >
                      {recorder.state === 'recording' ? (
                        <Square size={17} fill="currentColor" />
                      ) : (
                        <Mic size={20} />
                      )}
                      <span>
                        {recorder.state === 'recording'
                          ? 'Finish dictation'
                          : recorder.state === 'requesting'
                            ? 'Cancel request'
                            : recorder.state === 'transcribing'
                              ? 'Transcribing…'
                              : 'Start dictation'}
                      </span>
                      <kbd>Ctrl ⇧ ␣</kbd>
                    </button>
                    {recorder.busy && (
                      <button
                        className="icon-button cancel-button"
                        aria-label="Cancel dictation"
                        onClick={recorder.cancel}
                      >
                        <X size={18} />
                      </button>
                    )}
                  </div>
                  <div className="capture-links">
                    <button
                      onClick={() => audioFile.current?.click()}
                      disabled={recorder.busy || !configured}
                    >
                      <Upload size={14} />
                      Upload audio
                    </button>
                    <span>·</span>
                    <button onClick={demo} disabled={!loaded || recorder.busy}>
                      Try an example <ArrowRight size={14} />
                    </button>
                  </div>
                  <input
                    ref={audioFile}
                    type="file"
                    hidden
                    accept=".mp3,.mp4,.mpeg,.mpga,.m4a,.wav,.webm"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) recorder.importAudio(f, settings, terms);
                      e.target.value = '';
                    }}
                  />
                </div>
                {recorder.interim && (
                  <div className="live-transcript" aria-live="polite">
                    <span>LIVE TRANSCRIPT</span>
                    <p>{recorder.interim}</p>
                  </div>
                )}
                {recorder.error && (
                  <div className="notice warning" role="alert">
                    <span>{recorder.error}</span>
                    {recorder.canRetry && (
                      <div className="inline-actions">
                        <button onClick={recorder.retry}>
                          <RotateCcw size={14} />
                          Retry
                        </button>
                        <button onClick={recorder.downloadRecording}>Save audio</button>
                        <button onClick={recorder.cancel}>Discard</button>
                      </div>
                    )}
                  </div>
                )}
                <div className="capture-options">
                  <label>
                    <Headphones size={16} />
                    <select
                      aria-label="Transcription engine"
                      value={settings.engine}
                      onChange={(e) => update('engine', e.target.value as Settings['engine'])}
                      disabled={recorder.busy}
                    >
                      {!native && <option value="browser">Browser dictation</option>}
                      <option value="openai">{native ? speechLabel : 'OpenAI · accurate'}</option>
                    </select>
                  </label>
                  <label>
                    <span className="language-symbol">Aa</span>
                    <select
                      aria-label="Dictation language"
                      value={settings.language}
                      onChange={(e) => update('language', e.target.value)}
                      disabled={recorder.busy}
                    >
                      {languages.map(([v, l]) => (
                        <option value={v} key={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="shortcut-note">
                    {native
                      ? 'Global shortcuts configured in Desktop settings'
                      : 'Esc to cancel · Shortcut works in this tab'}
                  </span>
                </div>
              </section>
              {settings.engine === 'openai' && !configured && (
                <div className="notice">
                  <span>
                    {native
                      ? 'Configure your selected speech engine in Desktop settings.'
                      : 'OpenAI transcription needs a server connection.'}
                  </span>
                  <button onClick={() => choosePage(native ? 'desktop' : 'settings')}>
                    Set up transcription <ArrowRight size={14} />
                  </button>
                </div>
              )}
              {settings.engine === 'browser' && !recorder.supported && loaded && (
                <div className="notice">
                  <span>
                    Browser dictation is not supported here. Use Chrome or Edge, connect OpenAI, or paste text
                    below.
                  </span>
                </div>
              )}
              <section className="editor-card">
                <div className="editor-header">
                  <div>
                    <h2>Your draft</h2>
                    <p>The original transcript is retained alongside the edited text</p>
                  </div>
                  <div className="style-switch" role="group" aria-label="Cleanup style">
                    {Object.entries(styleLabels).map(([key, label]) => (
                      <button
                        disabled={recorder.busy}
                        className={settings.style === key ? 'selected' : ''}
                        aria-pressed={settings.style === key}
                        key={key}
                        onClick={() => {
                          const next = { ...settings, style: key as Style };
                          setSettings(next);
                          apply(raw, next);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="editor-grid">
                  <div className="editor-pane">
                    <label htmlFor="raw-text" className="pane-label">
                      ORIGINAL <span>{wordCount(raw)} words</span>
                    </label>
                    <textarea
                      id="raw-text"
                      value={raw}
                      onChange={(e) => {
                        setRaw(e.target.value);
                        if (!draft.current)
                          draft.current = {
                            id: newId(),
                            createdAt: Date.now(),
                            engine: 'Text editor',
                            duration: 0,
                          };
                      }}
                      placeholder="Your spoken words appear here. You can also paste or type a draft…"
                      disabled={recorder.busy}
                      maxLength={100000}
                    />
                    <div className="pane-footer">
                      <span>Original wording is preserved</span>
                      <button onClick={() => apply()} disabled={!raw.trim() || recorder.busy}>
                        <Sparkles size={14} />
                        Apply cleanup
                      </button>
                    </div>
                  </div>
                  <div className="editor-pane output-pane">
                    <label htmlFor="result-text" className="pane-label">
                      READY TO USE <span className="small-badge">{styleLabels[settings.style]}</span>
                    </label>
                    <textarea
                      id="result-text"
                      value={result}
                      onChange={(e) => setResult(e.target.value)}
                      placeholder="The cleaned-up text appears here for review"
                      disabled={recorder.busy}
                      maxLength={100000}
                    />
                    <div className="pane-footer">
                      <span>{changes.length ? changes.join(' · ') : 'Review and edit before you copy'}</span>
                      <button
                        aria-label="Restore original text"
                        onClick={() => {
                          setResult(raw);
                          setChanges([]);
                        }}
                        disabled={!raw || recorder.busy}
                      >
                        <RotateCcw size={14} />
                      </button>
                    </div>
                  </div>
                </div>
                {warning && (
                  <div className="review-warning">
                    <ShieldCheck size={16} />
                    Numbers or negation differ from the original. Please review both drafts.
                  </div>
                )}
                <div className="editor-actions">
                  <span className="save-indicator">
                    {saved ? (
                      <>
                        <Check size={14} />
                        {native ? 'Saved in encrypted profile' : 'Saved in this browser'}
                      </>
                    ) : settings.retention === 0 ? (
                      'History is off'
                    ) : (
                      <>
                        <Clock3 size={14} />
                        Save your changes to history
                      </>
                    )}
                  </span>
                  <div className="inline-actions">
                    <button
                      className="button ghost"
                      disabled={!result.trim() || recorder.busy}
                      onClick={() => {
                        saveEntry(result, raw);
                        if (settings.retention !== 0) notify('Draft saved to history');
                      }}
                    >
                      <History size={15} />
                      Save
                    </button>
                    <button
                      className="button ghost"
                      disabled={!result.trim()}
                      onClick={() => download('aeka-scribe-draft.txt', result)}
                    >
                      <Download size={15} />
                      Export
                    </button>
                    <button className="button primary" disabled={!result.trim()} onClick={() => void copy()}>
                      {copied ? <Check size={16} /> : <Copy size={16} />}Copy text
                    </button>
                  </div>
                </div>
              </section>
              <div className="studio-bottom">
                <div className="small-feature">
                  <BookOpen size={21} />
                  <div>
                    <h3>Custom vocabulary</h3>
                    <p>{terms.length} custom terms, ready to recognise.</p>
                    <button onClick={() => choosePage('vocabulary')}>
                      Manage vocabulary <ArrowRight size={13} />
                    </button>
                  </div>
                </div>
                <div className="small-feature">
                  <ShieldCheck size={21} />
                  <div>
                    <h3>Review before use</h3>
                    <p>
                      {settings.engine === 'browser'
                        ? 'Your browser’s speech service may process audio online.'
                        : native && speechLabel === 'Local Whisper'
                          ? 'Local Whisper processes audio on this PC.'
                          : 'Audio and chosen hints go to OpenAI when you record.'}{' '}
                      Aeka Scribe does not save audio on its server.
                    </p>
                    <button onClick={() => choosePage('settings')}>
                      Privacy & storage <ArrowRight size={13} />
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
          {page === 'history' && (
            <>
              <div className="stats-row">
                <div>
                  <span>Saved dictations</span>
                  <strong>{history.length}</strong>
                </div>
                <div>
                  <span>Words captured</span>
                  <strong>{totalWords.toLocaleString()}</strong>
                </div>
                <div>
                  <span>Recorded minutes</span>
                  <strong>{historyMinutes}</strong>
                </div>
                <div>
                  <span>Retention</span>
                  <strong className="smaller">
                    {settings.retention === 0
                      ? 'Off'
                      : settings.retention === -1
                        ? 'Until deleted'
                        : `${settings.retention} days`}
                  </strong>
                </div>
              </div>
              <div className="list-toolbar">
                <label className="search-box">
                  <Search size={17} />
                  <input
                    aria-label="Search history"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search your words…"
                  />
                </label>
                <button
                  className="button secondary"
                  aria-label="Export history"
                  disabled={!history.length}
                  onClick={() =>
                    download(
                      'aeka-scribe-history.txt',
                      history
                        .map(
                          (e) =>
                            `${new Date(e.createdAt).toLocaleString()} · ${e.engine}\n${e.text}\n\nOriginal:\n${e.raw}`,
                        )
                        .join('\n\n———\n\n'),
                    )
                  }
                >
                  <Download size={15} />
                  Export history
                </button>
              </div>
              {!filteredHistory.length ? (
                <div className="empty-state">
                  <History size={32} />
                  <h2>{search ? 'No matching dictations' : 'Your next thought starts here'}</h2>
                  <p>
                    {search
                      ? 'Try another word or clear your search.'
                      : 'Completed dictations appear here when history is enabled.'}
                  </p>
                  <button className="button secondary" onClick={() => choosePage('studio')}>
                    Open dictation <ArrowRight size={15} />
                  </button>
                </div>
              ) : (
                <div className="history-list">
                  {filteredHistory.map((entry) => (
                    <article className="history-item" key={entry.id}>
                      <div className="entry-meta">
                        <span>
                          {new Date(entry.createdAt).toLocaleString(undefined, {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        <span>
                          {entry.engine} · {wordCount(entry.text)} words
                          {entry.duration > 0 ? ` · ${duration(entry.duration)}` : ''}
                        </span>
                      </div>
                      <p>{entry.text}</p>
                      <details>
                        <summary>View original</summary>
                        <pre>{entry.raw}</pre>
                      </details>
                      <div className="entry-actions">
                        <button
                          disabled={recorder.busy}
                          onClick={() => {
                            if (
                              (raw || result) &&
                              !confirm('Replace the current draft with this saved dictation?')
                            )
                              return;
                            setRaw(entry.raw);
                            setResult(entry.text);
                            setChanges([]);
                            draft.current = {
                              id: entry.id,
                              createdAt: entry.createdAt,
                              engine: entry.engine,
                              duration: entry.duration,
                            };
                            update('style', entry.style);
                            choosePage('studio');
                          }}
                        >
                          Open in editor <ArrowUpRight size={14} />
                        </button>
                        <button onClick={() => void copy(entry.text)}>
                          <Copy size={14} />
                          Copy
                        </button>
                        <button
                          className="danger-link"
                          onClick={() => {
                            if (confirm('Delete this saved dictation?'))
                              setHistory((old) => old.filter((e) => e.id !== entry.id));
                          }}
                        >
                          <Trash2 size={14} />
                          Delete
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
          {page === 'vocabulary' && (
            <div className="management-grid">
              <section className="card">
                <div className="card-heading">
                  <h2>
                    Your vocabulary <span>{terms.length}</span>
                  </h2>
                  <BookOpen size={19} />
                </div>
                <label className="search-box inside">
                  <Search size={16} />
                  <input
                    aria-label="Search vocabulary"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Find a word or phrase"
                  />
                </label>
                <div className="vocabulary-list">
                  {terms
                    .filter((t) =>
                      (t.phrase + ' ' + t.replacement).toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((term) => (
                      <div className="term-row" key={term.id}>
                        <button
                          className="term-edit"
                          onClick={() => {
                            setEditTerm(term);
                            setTermPhrase(term.phrase);
                            setTermReplacement(term.replacement);
                          }}
                        >
                          <strong>{term.replacement}</strong>
                          <small>
                            {term.phrase === term.replacement
                              ? 'Recognition hint'
                              : `“${term.phrase}” → “${term.replacement}”`}
                          </small>
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`Delete ${term.replacement}`}
                          onClick={() => setTerms((old) => old.filter((t) => t.id !== term.id))}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                  {terms.length === 0 && (
                    <p className="empty-inline">Add a name or specialist term to get started.</p>
                  )}
                </div>
              </section>
              <div>
                <form className="card form-card" onSubmit={addTerm}>
                  <h2>{editTerm ? 'Edit a term' : 'Add a custom word'}</h2>
                  <p>Correct a recurring mistake, or add a name exactly as it should appear.</p>
                  <Field label="Spoken phrase">
                    <input
                      required
                      maxLength={80}
                      value={termPhrase}
                      onChange={(e) => setTermPhrase(e.target.value)}
                      placeholder="e.g. aeka advisors"
                    />
                  </Field>
                  <Field label="Preferred spelling">
                    <input
                      required
                      maxLength={80}
                      value={termReplacement}
                      onChange={(e) => setTermReplacement(e.target.value)}
                      placeholder="e.g. Aeka Advisors"
                    />
                  </Field>
                  <button className="button primary" type="submit">
                    <Plus size={16} />
                    {editTerm ? 'Save term' : 'Add to vocabulary'}
                  </button>
                  {editTerm && (
                    <button
                      type="button"
                      className="button ghost"
                      onClick={() => {
                        setEditTerm(null);
                        setTermPhrase('');
                        setTermReplacement('');
                      }}
                    >
                      Cancel edit
                    </button>
                  )}
                </form>
                <div className="explain-card">
                  <Sparkles size={20} />
                  <h3>Recognition hints</h3>
                  <p>
                    Cloud transcription receives the preferred spellings when vocabulary is enabled. Local
                    cleanup replaces complete phrases only. Verbatim mode keeps the transcript untouched.
                  </p>
                </div>
              </div>
            </div>
          )}
          {page === 'snippets' && (
            <div className="management-grid">
              <section className="card">
                <div className="card-heading">
                  <h2>
                    Your snippets <span>{snippets.length}</span>
                  </h2>
                  <FileText size={19} />
                </div>
                {snippets.map((snippet) => (
                  <article className="snippet-card" key={snippet.id}>
                    <span className="snippet-trigger">“{snippet.trigger}”</span>
                    <pre>{snippet.text}</pre>
                    <div className="entry-actions">
                      <button
                        disabled={recorder.busy}
                        onClick={() => {
                          const next = [raw, snippet.text].filter(Boolean).join('\n\n');
                          setRaw(next);
                          apply(next);
                          choosePage('studio');
                          notify('Snippet inserted into your draft');
                        }}
                      >
                        Insert into draft <ArrowRight size={14} />
                      </button>
                      <button
                        onClick={() => {
                          setEditSnippet(snippet);
                          setSnippetTrigger(snippet.trigger);
                          setSnippetText(snippet.text);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Delete snippet ${snippet.trigger}`}
                        onClick={() => setSnippets((old) => old.filter((s) => s.id !== snippet.id))}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </article>
                ))}
                {snippets.length === 0 && <p className="empty-inline">Add your first reusable phrase.</p>}
              </section>
              <div>
                <form className="card form-card" onSubmit={addSnippet}>
                  <h2>{editSnippet ? 'Edit snippet' : 'Create a snippet'}</h2>
                  <p>Choose an unusual trigger so ordinary speech stays ordinary speech.</p>
                  <Field label="Trigger phrase">
                    <input
                      required
                      maxLength={80}
                      value={snippetTrigger}
                      onChange={(e) => setSnippetTrigger(e.target.value)}
                      placeholder="e.g. insert my signature"
                    />
                  </Field>
                  <Field label="Expanded text">
                    <textarea
                      required
                      maxLength={5000}
                      value={snippetText}
                      onChange={(e) => setSnippetText(e.target.value)}
                      placeholder="The words you want to insert…"
                      rows={5}
                    />
                  </Field>
                  <button type="submit" className="button primary">
                    <Plus size={16} />
                    {editSnippet ? 'Save snippet' : 'Create snippet'}
                  </button>
                  {editSnippet && (
                    <button
                      type="button"
                      className="button ghost"
                      onClick={() => {
                        setEditSnippet(null);
                        setSnippetTrigger('');
                        setSnippetText('');
                      }}
                    >
                      Cancel edit
                    </button>
                  )}
                </form>
                <label className="toggle-card">
                  <span>
                    <strong>Expand spoken triggers</strong>
                    <small>Applied during cleanup. Off by default.</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.expandSnippets}
                    disabled={recorder.busy}
                    onChange={(e) => update('expandSnippets', e.target.checked)}
                  />
                </label>
              </div>
            </div>
          )}
          {page === 'models' && (
            <>
              <div className="model-grid">
                <article className="model-card recommended">
                  <span className="tag">RECOMMENDED FOR DICTATION</span>
                  <h2>gpt-transcribe</h2>
                  <p>
                    Record a thought, then receive a final transcript. Supports vocabulary and language hints.
                  </p>
                  <div className="model-price">
                    $0.0045 <span>/ minute</span>
                  </div>
                  <ul>
                    <li>Bounded recordings and audio uploads</li>
                    <li>Names, acronyms, and domain terminology</li>
                    <li>Used by this workspace’s cloud option</li>
                  </ul>
                  <a
                    href="https://developers.openai.com/api/docs/models/gpt-transcribe"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Official model details <ArrowUpRight size={15} />
                  </a>
                </article>
                <article className="model-card">
                  <span className="tag neutral">FOR A FUTURE LIVE PIPELINE</span>
                  <h2>gpt-live-transcribe</h2>
                  <p>Streaming audio recognition for text that appears as you speak.</p>
                  <div className="model-price">
                    $0.017 <span>/ minute</span>
                  </div>
                  <ul>
                    <li>Low latency transcript updates</li>
                    <li>Context, keyword, and language hints</li>
                    <li>Recommended; not integrated here yet</li>
                  </ul>
                  <a
                    href="https://developers.openai.com/api/docs/models/gpt-live-transcribe"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Official model details <ArrowUpRight size={15} />
                  </a>
                </article>
              </div>
              <section className="card cost-card">
                <div>
                  <h2>Indicative cost</h2>
                  <p>
                    Transcription only. Excludes hosting, taxes, and optional text rewriting. Rates checked 18
                    October 2026.
                  </p>
                </div>
                <Field label="Audio minutes per month">
                  <input
                    type="number"
                    min={0}
                    max={100000}
                    value={minutes}
                    onChange={(e) => setMinutes(Math.min(100000, Math.max(0, Number(e.target.value) || 0)))}
                  />
                </Field>
                <div className="cost-figures">
                  <div>
                    <span>gpt-transcribe</span>
                    <strong>${(minutes * 0.0045).toFixed(2)}</strong>
                  </div>
                  <div>
                    <span>gpt-live-transcribe</span>
                    <strong>${(minutes * 0.017).toFixed(2)}</strong>
                  </div>
                </div>
              </section>
              <section className="card testing-guide">
                <h2>Compare models on your own recordings</h2>
                <p>
                  No model is proven best for your accent until it is tested on representative recordings.
                  Compare names, Indian amounts, section references, negation, and code switching.
                </p>
                <div className="benchmark-samples">
                  <p>“The amount is twelve lakh fifty thousand, not fifteen lakh.”</p>
                  <p>“Please send the Ind AS reconciliation to Aeka Advisors.”</p>
                  <p>“Do not file this version. I will send the corrected draft.”</p>
                </div>
                <p className="muted">
                  Useful alternatives to benchmark:{' '}
                  <a href="https://developers.deepgram.com/docs/keyterm" target="_blank" rel="noreferrer">
                    Deepgram Nova-3
                  </a>{' '}
                  and{' '}
                  <a
                    href="https://elevenlabs.io/docs/overview/capabilities/speech-to-text"
                    target="_blank"
                    rel="noreferrer"
                  >
                    ElevenLabs Scribe v2
                  </a>
                  . For private local inference, evaluate an open-weight ASR model separately on your Windows
                  hardware. This workspace has not benchmarked these models.
                </p>
              </section>
            </>
          )}
          {page === 'settings' && (
            <div className="settings-stack">
              <section className="card settings-card">
                <div className="settings-title">
                  <Headphones size={22} />
                  <div>
                    <h2>Transcription</h2>
                    <p>Choose where your audio is processed.</p>
                  </div>
                </div>
                <div className="settings-body">
                  <Field label="Speech engine">
                    <select
                      value={settings.engine}
                      disabled={recorder.busy}
                      onChange={(e) => update('engine', e.target.value as Settings['engine'])}
                    >
                      {!native && <option value="browser">Browser dictation</option>}
                      <option value="openai">
                        {native ? 'Desktop engine · choose in Desktop settings' : 'OpenAI · gpt-transcribe'}
                      </option>
                    </select>
                  </Field>
                  <Field label="Preferred language">
                    <select
                      value={settings.language}
                      disabled={recorder.busy}
                      onChange={(e) => update('language', e.target.value)}
                    >
                      {languages.map(([v, l]) => (
                        <option value={v} key={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="connection-box">
                    <span className={'status-dot ' + (configured ? 'green' : '')} />
                    <div>
                      <strong>
                        {configured
                          ? native
                            ? 'Speech engine configured'
                            : 'OpenAI is connected'
                          : statusError
                            ? 'Connection status unavailable'
                            : 'OpenAI is not connected'}
                      </strong>
                      <p>
                        {configured
                          ? native
                            ? 'Desktop settings determine whether speech uses local Whisper or OpenAI.'
                            : 'Your API key stays on the server. Audio is sent to OpenAI for requested transcription.'
                          : native
                            ? 'Open Desktop setup to save your own API key.'
                            : 'Ask Codex to configure OpenAI through the OpenAI Developers connection. Browser dictation and text editing remain available.'}
                      </p>
                    </div>
                    <button
                      className="icon-button"
                      onClick={refreshStatus}
                      aria-label="Refresh connection status"
                    >
                      <RotateCcw size={16} />
                    </button>
                  </div>
                  <p className="small-print">
                    Browser speech recognition is managed by your browser and may use an online speech
                    service. Choosing Browser mode does not guarantee offline transcription.
                  </p>
                  <Field
                    label="Optional context for cloud transcription"
                    hint="Only this text and enabled vocabulary are sent as hints. Only explicitly enabled selected-text access reads another app in the Windows version."
                  >
                    <textarea
                      value={settings.context}
                      onChange={(e) => update('context', e.target.value)}
                      maxLength={1000}
                      rows={3}
                      placeholder="e.g. A tax advisory discussion in Indian English."
                      disabled={recorder.busy}
                    />
                  </Field>
                </div>
              </section>
              <section className="card settings-card">
                <div className="settings-title">
                  <Mic size={22} />
                  <div>
                    <h2>Microphone & cleanup</h2>
                    <p>Small preferences for a smoother session.</p>
                  </div>
                </div>
                <div className="settings-body">
                  <Field
                    label="Microphone for cloud recording"
                    hint="Browser dictation uses your browser’s default microphone."
                  >
                    <select
                      value={settings.deviceId}
                      disabled={recorder.busy}
                      onChange={(e) => update('deviceId', e.target.value)}
                    >
                      <option value="">System default</option>
                      {devices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || 'Microphone'}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <button
                    className="button secondary"
                    disabled={recorder.busy}
                    onClick={() => void getDevices()}
                  >
                    Refresh microphones
                  </button>
                  <label className="toggle-row">
                    <span>
                      <strong>Use custom vocabulary</strong>
                      <small>Send cloud recognition hints and apply local phrase replacements.</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.useVocabulary}
                      onChange={(e) => update('useVocabulary', e.target.checked)}
                      disabled={recorder.busy}
                    />
                  </label>
                  <label className="toggle-row">
                    <span>
                      <strong>Expand snippet triggers</strong>
                      <small>Replace exact trigger phrases during cleanup.</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={settings.expandSnippets}
                      onChange={(e) => update('expandSnippets', e.target.checked)}
                      disabled={recorder.busy}
                    />
                  </label>
                  <p className="small-print">
                    Cleanup is deterministic: hesitation sounds, spacing, vocabulary, and optional sentence or
                    bullet layout. It does not use a rewriting LLM or infer corrections to facts.
                  </p>
                </div>
              </section>
              <section className="card settings-card">
                <div className="settings-title">
                  <ShieldCheck size={22} />
                  <div>
                    <h2>Privacy & history</h2>
                    <p>Your saved text, under your control.</p>
                  </div>
                </div>
                <div className="settings-body">
                  <Field
                    label="Keep local history"
                    hint="Retention is applied while this workspace is open and when you return. Shortening it removes older records."
                  >
                    <select
                      value={settings.retention}
                      onChange={(e) => {
                        const days = Number(e.target.value);
                        if (
                          pruneHistory(history, days).length < history.length &&
                          !confirm(
                            'This will remove history outside the selected retention period. Continue?',
                          )
                        )
                          return;
                        update('retention', days);
                      }}
                    >
                      <option value={0}>Do not store</option>
                      <option value={1}>24 hours</option>
                      <option value={7}>7 days</option>
                      <option value={30}>30 days</option>
                      <option value={-1}>Until I delete it</option>
                    </select>
                  </Field>
                  <p className="small-print">
                    {native
                      ? 'History, vocabulary, snippets and preferences are saved in your encrypted Windows vault.'
                      : 'History, vocabulary, snippets and preferences stay in unencrypted browser storage.'}{' '}
                    Audio is not saved in dictation history. Failed cloud recordings stay in memory until you
                    retry, discard, or leave the page. Provider retention is separate from these local
                    controls.
                  </p>
                  <div className="inline-actions wrap">
                    <button className="button secondary" onClick={exportBackup}>
                      <Download size={15} />
                      Export backup
                    </button>
                    <button
                      className="button secondary"
                      disabled={recorder.busy}
                      onClick={() => restoreFile.current?.click()}
                    >
                      <Upload size={15} />
                      Restore backup
                    </button>
                    <button
                      className="button danger"
                      disabled={!history.length}
                      onClick={() => {
                        if (confirm('Delete all saved dictations from this browser?')) {
                          setHistory([]);
                          notify('History cleared');
                        }
                      }}
                    >
                      <Trash2 size={15} />
                      Clear history
                    </button>
                  </div>
                  <input
                    hidden
                    ref={restoreFile}
                    type="file"
                    accept=".json,application/json"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void restore(f);
                      e.target.value = '';
                    }}
                  />
                </div>
              </section>
              <section className="card settings-card">
                <div className="settings-title">
                  <SlidersHorizontal size={22} />
                  <div>
                    <h2>Workspace capabilities</h2>
                    <p>Dictation, notes and an optional Windows companion.</p>
                  </div>
                </div>
                <div className="settings-body">
                  <p>
                    Use <kbd>Ctrl + Shift + Space</kbd> to start or finish dictation while this tab is
                    focused. Use <kbd>Esc</kbd> to cancel. Copy your reviewed text into Word, Outlook, or
                    another app.
                  </p>
                  <p className="small-print">
                    The Windows package adds system-wide shortcuts, guarded text insertion, optional
                    selected-text context, system audio capture, calendar reminders and a tray overlay. Open
                    Desktop setup for setup and feature status.
                  </p>
                  <button className="text-link" onClick={() => choosePage('desktop')}>
                    Desktop setup & feature status <ArrowUpRight size={15} />
                  </button>
                </div>
              </section>
            </div>
          )}
          {ModuleView && (
            <Suspense fallback={<p className="muted">Loading…</p>}>
              <ModuleView page={current.page.id} navigate={choosePage} notify={notify} />
            </Suspense>
          )}
          <WorkspacePanel
            page={page}
            deviceId={settings.deviceId}
            language={settings.language}
            terms={terms}
            snippets={snippets}
            onImportResources={(r) => {
              setTerms((old) =>
                [
                  ...old,
                  ...r.terms
                    .filter((t) => !old.some((o) => o.phrase.toLowerCase() === t.phrase.toLowerCase()))
                    .map((t) => ({ ...t, id: newId() })),
                ].slice(0, 500),
              );
              setSnippets((old) =>
                [
                  ...old,
                  ...r.snippets
                    .filter((t) => !old.some((o) => o.trigger.toLowerCase() === t.trigger.toLowerCase()))
                    .map((t) => ({ ...t, id: newId() })),
                ].slice(0, 200),
              );
            }}
            dictationBusy={recorder.busy}
            notify={notify}
            onNavigate={choosePage}
            onStatusChange={refreshStatus}
            onMeetingBusy={setMeetingBusy}
          />
          <footer className="page-footer">
            <span>Aeka Advisors India LLP</span>
            <span>{native ? 'Aeka Scribe' : 'Aeka Workspace'}</span>
          </footer>
        </div>
      </main>
      {recorder.busy && page !== 'studio' && (
        <div className="floating-recorder">
          <span className="live-dot" />
          {recorder.state === 'recording' ? `Recording ${duration(recorder.elapsed)}` : recorder.state}
          <button onClick={() => choosePage('studio')}>Open</button>
          <button onClick={recorder.cancel}>Cancel</button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}
