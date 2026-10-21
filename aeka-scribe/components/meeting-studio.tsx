'use client';
import { NoteWorkflows } from './note-workflows';
import { ContextAttachments } from './context-attachments';
import { useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  FileText,
  Plus,
  Trash2,
  Star,
  Download,
  Search,
  ArrowUpRight,
  RotateCcw,
} from 'lucide-react';
import { runtime, isDesktop } from '../lib/desktop-runtime';
import { newId } from '../lib/flow-core';
import { type Note, citationsFromAnswer } from '../lib/workspace-core';
import { noteDetails, noteFolders, isTrashed, type NoteDetails } from '../lib/note-details';
import {
  builtinTemplates,
  builtinRecipes,
  defaultStudio,
  validStudio,
  peopleDirectory,
  scopeNotes,
  draftEmail,
  actionsCalendar,
  type StudioConfig,
  type Recipe,
  type NoteTemplate,
  type ChatScope,
  type EvidenceSource,
} from '../lib/meeting-studio';
const errorText = (e: unknown) => (e instanceof Error ? e.message : 'The action could not finish.');
const stamp = (s: number) =>
  `${Math.floor(s / 60)}:${Math.floor(s % 60)
    .toString()
    .padStart(2, '0')}`;
export async function studioDownload(name: string, text: string, type = 'text/plain;charset=utf-8') {
  if (isDesktop()) await runtime('export.check');
  const u = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement('a');
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
export function useStudioConfig() {
  const [config, setConfig] = useState<StudioConfig>(defaultStudio),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(''),
    [ready, setReady] = useState(false);
  const reload = async () => {
    try {
      const r = await runtime('studio.get');
      setConfig(r.config);
      setRevision(r.revision);
      setReady(true);
      setError('');
    } catch (e) {
      setError(errorText(e));
    }
  };
  useEffect(() => {
    void reload();
  }, []);
  const save = async (value: StudioConfig) => {
    const r = await runtime('studio.save', { config: validStudio(value), revision });
    setConfig(r.config);
    setRevision(r.revision);
    setError('');
  };
  return { config, setConfig, save, reload, ready, error };
}
export function Sources({
  text,
  sources,
  onOpen,
}: {
  text: string;
  sources: EvidenceSource[];
  onOpen?: (id: string) => void;
}) {
  const valid = citationsFromAnswer(
      text,
      sources.map((n) => n.id),
    ),
    unknown = [...text.matchAll(/\[note:([\w-]+)\]/g)].some((x) => !sources.some((s) => s.id === x[1]));
  return (
    <div className="studio-sources">
      {unknown && (
        <p className="inline-error">
          The answer contains an unverified reference. Check the evidence before using it.
        </p>
      )}
      <details>
        <summary>
          {valid.length} cited meeting{valid.length === 1 ? '' : 's'} · inspect supplied evidence
        </summary>
        {sources.map((s) => (
          <article key={s.id}>
            <button className="text-link" type="button" onClick={() => onOpen?.(s.id)} disabled={!onOpen}>
              {s.title} {valid.includes(s.id) && '· cited'}
            </button>
            <small>{new Date(s.createdAt).toLocaleDateString()}</small>
            {s.excerpt && <p>{s.excerpt}</p>}
            {s.segments.slice(0, 8).map((x) => (
              <p key={x.id}>
                <time>{stamp(x.start)}</time> {x.text}
              </p>
            ))}
            {s.segments.length > 8 && <small>Open the meeting for the remaining source segments.</small>}
          </article>
        ))}
      </details>
    </div>
  );
}
function ListInput({
  value,
  onChange,
  limit,
  maxLength,
  placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  limit: number;
  maxLength: number;
  placeholder?: string;
}) {
  const [text, setText] = useState(value.join(', '));
  const serial = JSON.stringify(value);
  useEffect(() => setText(value.join(', ')), [serial]);
  return (
    <input
      placeholder={placeholder}
      value={text}
      maxLength={maxLength}
      onChange={(e) => setText(e.target.value)}
      onBlur={() =>
        onChange(
          [
            ...new Set(
              text
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean),
            ),
          ].slice(0, limit),
        )
      }
    />
  );
}
export function NoteStudio({
  note,
  config,
  onChange,
  onSave,
  onOpen,
  configured,
  locked,
  notify,
}: {
  note: Note;
  config: StudioConfig;
  onChange: (n: Note) => void;
  onSave: () => Promise<Note | undefined>;
  onOpen: (id: string) => void;
  configured: boolean;
  locked: boolean;
  notify: (s: string) => void;
}) {
  const d = noteDetails(note),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [result, setResult] = useState<any>(null),
    [editInstruction, setEditInstruction] = useState(''),
    [selectedText, setSelectedText] = useState('');
  const details = (patch: Partial<NoteDetails>) => onChange({ ...note, details: { ...d, ...patch } });
  const run = async (kind: string) => {
    setBusy(kind);
    setError('');
    try {
      await onSave();
      const r = await runtime('ai', {
        kind,
        noteIds: [note.id],
        text: kind === 'transform' ? selectedText : '',
        instruction: editInstruction,
      });
      setResult({ ...r, kind, originalSummary: note.summary, originalText: selectedText });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  };
  const apply = () => {
    if (result.kind === 'summary') {
      const versions = note.summary
        ? [{ id: newId(), at: Date.now(), summary: note.summary }, ...d.versions].slice(0, 8)
        : d.versions;
      onChange({ ...note, summary: result.text, details: { ...d, versions } });
    }
    if (result.kind === 'brief') details({ brief: result.text.slice(0, 30000) });
    if (result.kind === 'followup') details({ followUp: result.text.slice(0, 30000) });
    if (result.kind === 'actions') {
      const existing = new Set(d.actions.map((a) => a.text.toLowerCase().trim()));
      details({
        actions: [
          ...d.actions,
          ...result.actions
            .filter((a: any) => !existing.has(a.text.toLowerCase().trim()))
            .map((a: any) => ({ ...a, id: newId(), done: false, segmentId: '' })),
        ].slice(0, 200),
      });
    }
    if (result.kind === 'transform') {
      if (
        !result.originalText ||
        !note.summary.includes(result.originalText) ||
        note.summary.indexOf(result.originalText) !== note.summary.lastIndexOf(result.originalText)
      ) {
        setError(
          'The selected passage changed or occurs more than once. Select a unique passage and try again.',
        );
        return;
      }
      onChange({
        ...note,
        summary: note.summary.replace(result.originalText, result.text),
        details: {
          ...d,
          versions: [{ id: newId(), at: Date.now(), summary: note.summary }, ...d.versions].slice(0, 8),
        },
      });
    }
    setResult(null);
    notify('Applied to your draft. Save the note to keep it.');
  };
  return (
    <section className="note-studio">
      <div className="note-section-title">
        <h3>
          <Sparkles size={16} />
          Meeting toolkit
        </h3>
        <button
          className={'button ghost ' + (d.starred ? 'is-starred' : '')}
          onClick={() => details({ starred: !d.starred })}
        >
          <Star size={15} fill={d.starred ? 'currentColor' : 'none'} />
          {d.starred ? 'Starred' : 'Star'}
        </button>
      </div>
      {error && (
        <p className="notice warning" role="alert">
          {error}
        </p>
      )}
      <div className="studio-grid">
        <label className="field">
          <span>Summary template</span>
          <select value={d.templateId} onChange={(e) => details({ templateId: e.target.value })}>
            {[...builtinTemplates, ...config.templates].map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Attendees · comma-separated emails</span>
          <ListInput
            value={d.attendees}
            limit={250}
            maxLength={4000}
            onChange={(v) => details({ attendees: v })}
          />
        </label>
        <label className="field">
          <span>Additional folders · comma-separated</span>
          <ListInput
            placeholder="Clients/Acme, Projects"
            value={d.folders}
            limit={12}
            maxLength={1200}
            onChange={(v) => details({ folders: v })}
          />
        </label>
        <label className="field">
          <span>Tags · comma-separated</span>
          <ListInput
            placeholder="decisions, follow-up"
            value={d.tags}
            limit={30}
            maxLength={1800}
            onChange={(v) => details({ tags: v })}
          />
        </label>
      </div>
      <div className="inline-actions wrap">
        {[
          ['summary', 'Enhanced notes'],
          ['brief', 'Prepare brief'],
          ['followup', 'Follow-up email'],
          ['actions', 'Extract actions'],
        ].map(([k, label]) => (
          <button
            className="button secondary"
            key={k}
            disabled={!!busy || !configured || (locked && k !== 'brief')}
            onClick={() => void run(k)}
          >
            <Sparkles size={14} />
            {busy === k ? 'Preparing…' : label}
          </button>
        ))}
      </div>
      {!configured && (
        <p className="small-print">
          Connect OpenAI in settings for AI drafts. Templates, attachments, edits and checklists work without
          it.
        </p>
      )}
      {result && (
        <div className="studio-review">
          <h4>Review {result.kind === 'transform' ? 'section edit' : result.kind} before applying</h4>
          <textarea
            aria-label="AI draft to review"
            value={result.text}
            maxLength={100000}
            readOnly={result.kind === 'actions'}
            onChange={(e) => setResult({ ...result, text: e.target.value })}
          />
          <p className="small-print">
            {result.coverage?.used || 0} meeting(s) used
            {result.coverage?.excerpted ? ' · evidence was excerpted' : ''}. Check names, dates and
            commitments.
          </p>
          <Sources text={result.text} sources={result.sources || []} onOpen={onOpen} />
          <div className="inline-actions">
            <button className="button primary" onClick={apply}>
              Apply to draft
            </button>
            <button className="button ghost" onClick={() => setResult(null)}>
              Discard
            </button>
          </div>
        </div>
      )}
      <details className="studio-details">
        <summary>Pre-meeting brief {d.brief && '· saved in this draft'}</summary>
        <p className="small-print">
          Uses earlier saved meetings with matching people, company email domains or the same title. It can
          use email previews you explicitly attach. It does not search your inbox or the web.
        </p>
        <textarea
          aria-label="Pre-meeting brief"
          value={d.brief}
          maxLength={30000}
          onChange={(e) => details({ brief: e.target.value })}
          placeholder="Prepare a brief, or write your agenda here."
        />
      </details>
      <details className="studio-details">
        <summary>Follow-up email draft</summary>
        <textarea
          aria-label="Follow-up email draft"
          value={d.followUp}
          maxLength={30000}
          onChange={(e) => details({ followUp: e.target.value })}
          placeholder="Generate a draft above, then review recipients and commitments."
        />
        <div className="inline-actions">
          <button
            className="button secondary"
            disabled={!d.followUp}
            onClick={() =>
              void navigator.clipboard
                .writeText(d.followUp)
                .then(() => notify('Draft copied'))
                .catch(() => setError('Clipboard blocked. Select and copy the draft.'))
            }
          >
            Copy draft
          </button>
          <button
            className="button ghost"
            disabled={!d.followUp}
            onClick={() =>
              void studioDownload('Flow-follow-up.eml', draftEmail(note), 'message/rfc822').catch((e) =>
                setError(errorText(e)),
              )
            }
          >
            Download email draft
          </button>
        </div>
        <p className="small-print">
          Open the draft in your email app and choose recipients. Flow has not sent it.
        </p>
      </details>
      <details className="studio-details">
        <summary>
          Action checklist · {d.actions.filter((a) => a.done).length}/{d.actions.length} complete
        </summary>
        <div className="action-list">
          {d.actions.map((a) => (
            <div className="action-row" key={a.id}>
              <input
                aria-label={'Complete ' + a.text}
                type="checkbox"
                checked={a.done}
                onChange={(e) =>
                  details({
                    actions: d.actions.map((x) => (x.id === a.id ? { ...x, done: e.target.checked } : x)),
                  })
                }
              />
              <input
                aria-label="Action"
                maxLength={2000}
                value={a.text}
                onChange={(e) =>
                  details({
                    actions: d.actions.map((x) => (x.id === a.id ? { ...x, text: e.target.value } : x)),
                  })
                }
              />
              <input
                aria-label="Action owner"
                placeholder="Owner"
                maxLength={254}
                value={a.owner}
                onChange={(e) =>
                  details({
                    actions: d.actions.map((x) => (x.id === a.id ? { ...x, owner: e.target.value } : x)),
                  })
                }
              />
              <input
                aria-label="Action due date"
                type="date"
                value={a.due}
                onChange={(e) =>
                  details({
                    actions: d.actions.map((x) => (x.id === a.id ? { ...x, due: e.target.value } : x)),
                  })
                }
              />
              <button
                className="icon-button"
                aria-label="Remove action"
                onClick={() => details({ actions: d.actions.filter((x) => x.id !== a.id) })}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="inline-actions wrap">
          <button
            className="button ghost"
            disabled={d.actions.length >= 200}
            onClick={() =>
              details({
                actions: [
                  ...d.actions,
                  { id: newId(), text: '', owner: '', due: '', done: false, segmentId: '' },
                ],
              })
            }
          >
            <Plus size={14} />
            Add action
          </button>
          <button
            className="button ghost"
            disabled={!d.actions.some((a) => a.due)}
            onClick={() =>
              void studioDownload('Flow-actions.ics', actionsCalendar(note), 'text/calendar').catch((e) =>
                setError(errorText(e)),
              )
            }
          >
            Export dated tasks
          </button>
        </div>
        <p className="small-print">
          The calendar file contains tasks with explicit due dates. Import it into a task/calendar app that
          supports VTODO. No invitations are sent.
        </p>
      </details>
      <NoteWorkflows note={note} onSave={onSave} onContext={(context) => details({ context })} />
      <ContextAttachments
        noteId={note.id}
        context={d.context}
        configured={configured}
        onChange={(context) => details({ context })}
      />
      <details className="studio-details">
        <summary>Edit a summary section or restore a revision</summary>
        <p className="small-print">
          Paste a unique passage from the summary and describe the change. Review the result before replacing
          it.
        </p>
        <textarea
          aria-label="Summary passage to edit"
          value={selectedText}
          maxLength={50000}
          onChange={(e) => setSelectedText(e.target.value)}
          placeholder="Paste the exact passage…"
        />
        <input
          aria-label="Summary editing instruction"
          value={editInstruction}
          maxLength={4000}
          onChange={(e) => setEditInstruction(e.target.value)}
          placeholder="For example: shorten this to three bullets"
        />
        <button
          className="button secondary"
          disabled={!!busy || !configured || !selectedText || !editInstruction}
          onClick={() => void run('transform')}
        >
          Edit passage
        </button>
        {d.versions.map((v) => (
          <div className="revision-row" key={v.id}>
            <span>
              {new Date(v.at).toLocaleString()} · {v.summary.length} characters
            </span>
            <button
              className="button ghost"
              onClick={() => {
                onChange({
                  ...note,
                  summary: v.summary,
                  details: {
                    ...d,
                    versions: [
                      { id: newId(), at: Date.now(), summary: note.summary },
                      ...d.versions.filter((x) => x.id !== v.id),
                    ].slice(0, 8),
                  },
                });
                notify('Revision restored to draft. Save to keep it.');
              }}
            >
              <RotateCcw size={13} />
              Restore
            </button>
          </div>
        ))}
      </details>
    </section>
  );
}
export function TranscriptEditor({
  note,
  onChange,
  locked,
}: {
  note: Note;
  onChange: (n: Note) => void;
  locked: boolean;
}) {
  const [query, setQuery] = useState(''),
    [edit, setEdit] = useState('');
  const d = noteDetails(note);
  return (
    <div className="transcript-editor">
      <label className="search-box">
        <Search size={15} />
        <input
          aria-label="Search within transcript"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find in transcript…"
        />
      </label>
      <div className="transcript-segments">
        {note.segments
          .filter((s) =>
            (s.text + ' ' + (note.speakers[s.speaker] || s.speaker))
              .toLowerCase()
              .includes(query.toLowerCase()),
          )
          .map((s) => (
            <div
              className={'transcript-segment ' + (d.highlights.includes(s.id) ? 'highlighted' : '')}
              key={s.id}
              id={'segment-' + s.id}
            >
              <time>{stamp(s.start)}</time>
              <div>
                {s.speaker && (
                  <input
                    aria-label={'Name for ' + s.speaker}
                    maxLength={100}
                    value={note.speakers[s.speaker] || s.speaker}
                    onChange={(e) =>
                      onChange({ ...note, speakers: { ...note.speakers, [s.speaker]: e.target.value } })
                    }
                  />
                )}
                <p>{s.text}</p>
                {edit === s.id && (
                  <textarea
                    aria-label="Correct transcript segment"
                    maxLength={20000}
                    value={s.text}
                    onChange={(e) =>
                      onChange({
                        ...note,
                        segments: note.segments.map((x) =>
                          x.id === s.id ? { ...x, text: e.target.value } : x,
                        ),
                      })
                    }
                  />
                )}
                <div className="inline-actions wrap">
                  <button
                    className="text-link"
                    onClick={() =>
                      onChange({
                        ...note,
                        details: {
                          ...d,
                          highlights: d.highlights.includes(s.id)
                            ? d.highlights.filter((id) => id !== s.id)
                            : [...d.highlights, s.id].slice(0, 200),
                        },
                      })
                    }
                  >
                    {d.highlights.includes(s.id) ? 'Unhighlight' : 'Highlight'}
                  </button>
                  <button
                    className="text-link"
                    disabled={locked}
                    onClick={() => setEdit(edit === s.id ? '' : s.id)}
                  >
                    {edit === s.id ? 'Close editor' : 'Correct text'}
                  </button>
                  <button
                    className="text-link"
                    disabled={locked}
                    onClick={() => {
                      if (
                        confirm(
                          'Remove this transcript segment from the note? Existing summaries, exports and retained raw audio are separate and will not be erased.',
                        )
                      )
                        onChange({
                          ...note,
                          segments: note.segments.filter((x) => x.id !== s.id),
                          details: { ...d, highlights: d.highlights.filter((x) => x !== s.id) },
                        });
                    }}
                  >
                    Remove segment
                  </button>
                </div>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
export function StudioSettings({ notify }: { notify: (s: string) => void }) {
  const state = useStudioConfig(),
    { config, setConfig } = state,
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [tab, setTab] = useState<'templates' | 'recipes'>('templates'),
    [search, setSearch] = useState(''),
    [template, setTemplate] = useState<NoteTemplate | null>(null),
    [recipe, setRecipe] = useState<Recipe | null>(null),
    [headings, setHeadings] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const save = async (next: StudioConfig) => {
    setBusy(true);
    setError('');
    try {
      await state.save(next);
      notify('Templates and recipes saved');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (template || recipe)
      document.querySelector('.studio-compose')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [template?.id, recipe?.id]);
  const editTemplate = (t: NoteTemplate, copy = false) => {
    setTemplate({ ...t, id: copy ? newId() : t.id, name: copy ? t.name + ' (copy)' : t.name });
    setHeadings(t.sections.join('\n'));
    setRecipe(null);
  };
  return (
    <div className="studio-settings">
      <section className="card form-card">
        <div className="card-heading">
          <div>
            <span className="eyebrow">YOUR MEETING PLAYBOOK</span>
            <h2>Templates & recipes</h2>
            <p>Templates structure a meeting. Recipes ask a repeatable question across one or many.</p>
          </div>
          <button
            className="button ghost"
            onClick={() => {
              if (confirm('Reload saved templates and discard unsaved changes?')) void state.reload();
            }}
          >
            Reload
          </button>
        </div>
        {(error || state.error) && (
          <p className="notice warning" role="alert">
            {error || state.error}
          </p>
        )}
        <div className="studio-grid">
          <label className="field">
            <span>Default template for new meetings</span>
            <select
              value={config.defaultTemplate}
              onChange={(e) => setConfig({ ...config, defaultTemplate: e.target.value })}
            >
              {[...builtinTemplates, ...config.templates].map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Output language</span>
            <input
              value={config.language}
              maxLength={100}
              onChange={(e) => setConfig({ ...config, language: e.target.value })}
            />
          </label>
        </div>
        <label className="field">
          <span>About your role · optional context for requested AI work</span>
          <textarea
            value={config.context}
            maxLength={2000}
            rows={2}
            placeholder="Role, team terminology, preferred level of detail…"
            onChange={(e) => setConfig({ ...config, context: e.target.value })}
          />
        </label>
        <div className="inline-actions wrap">
          <button
            className="button primary"
            disabled={busy || !state.ready}
            onClick={() => void save(config)}
          >
            Save preferences
          </button>
          <button
            className="button ghost"
            onClick={() =>
              void studioDownload(
                'Flow-templates-recipes.json',
                JSON.stringify(config, null, 2),
                'application/json',
              ).catch((e) => setError(errorText(e)))
            }
          >
            <Download size={14} />
            Export playbook
          </button>
          <button className="button ghost" disabled={!state.ready} onClick={() => file.current?.click()}>
            Import playbook
          </button>
          <input
            hidden
            ref={file}
            type="file"
            accept=".json"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                if (f.size > 250000) throw Error('Choose a playbook under 250 KB.');
                const value = validStudio(JSON.parse(await f.text()));
                if (confirm('Replace your templates, recipes and preferences with this playbook?'))
                  await save(value);
              } catch (err) {
                setError(errorText(err));
              }
            }}
          />
        </div>
        <p className="small-print">
          Playbooks are saved in this workspace. Use export/import to share a copy or move one between desktop
          and web. Note sync does not sync playbook preferences.
        </p>
      </section>
      <div className="notes-toolbar">
        <div className="inline-actions">
          <button
            className={'button ' + (tab === 'templates' ? 'primary' : 'secondary')}
            onClick={() => setTab('templates')}
          >
            Templates
          </button>
          <button
            className={'button ' + (tab === 'recipes' ? 'primary' : 'secondary')}
            onClick={() => setTab('recipes')}
          >
            Recipes
          </button>
        </div>
        <label className="search-box">
          <Search size={15} />
          <input
            aria-label="Search playbook"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search names and prompts…"
          />
        </label>
        <button
          className="button secondary"
          onClick={() =>
            tab === 'templates'
              ? editTemplate({
                  id: newId(),
                  name: 'New template',
                  instructions: '',
                  sections: ['Overview', 'Next steps'],
                })
              : (setRecipe({ id: newId(), name: 'New recipe', prompt: '', scope: 'multiple' }),
                setTemplate(null))
          }
        >
          <Plus size={14} />
          Create {tab === 'templates' ? 'template' : 'recipe'}
        </button>
      </div>
      <div className="playbook-grid">
        {tab === 'templates'
          ? [...builtinTemplates, ...config.templates]
              .filter((t) => (t.name + ' ' + t.instructions).toLowerCase().includes(search.toLowerCase()))
              .map((t) => (
                <article className="card playbook-card" key={t.id}>
                  <span className="eyebrow">
                    {builtinTemplates.some((b) => b.id === t.id) ? 'FLOW TEMPLATE' : 'YOUR TEMPLATE'}
                  </span>
                  <h3>{t.name}</h3>
                  <p>{t.instructions}</p>
                  <small>{t.sections.join(' · ')}</small>
                  <div className="inline-actions">
                    <button
                      className="button ghost"
                      onClick={() =>
                        editTemplate(
                          t,
                          builtinTemplates.some((b) => b.id === t.id),
                        )
                      }
                    >
                      {builtinTemplates.some((b) => b.id === t.id) ? 'Make a copy' : 'Edit'}
                    </button>
                    {config.templates.some((b) => b.id === t.id) && (
                      <button
                        className="button ghost"
                        disabled={busy}
                        onClick={() => {
                          if (confirm('Remove this custom template?'))
                            void save({
                              ...config,
                              defaultTemplate:
                                config.defaultTemplate === t.id ? 'auto' : config.defaultTemplate,
                              templates: config.templates.filter((x) => x.id !== t.id),
                            });
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </article>
              ))
          : [...builtinRecipes, ...config.recipes]
              .filter((r) => (r.name + ' ' + r.prompt).toLowerCase().includes(search.toLowerCase()))
              .map((r) => (
                <article className="card playbook-card" key={r.id}>
                  <span className="eyebrow">{r.scope === 'single' ? 'ONE MEETING' : 'ACROSS MEETINGS'}</span>
                  <h3>{r.name}</h3>
                  <p>{r.prompt}</p>
                  <div className="inline-actions">
                    <button
                      className="button ghost"
                      onClick={() => {
                        const copy = builtinRecipes.some((b) => b.id === r.id);
                        setRecipe({
                          ...r,
                          id: copy ? newId() : r.id,
                          name: r.name + (copy ? ' (copy)' : ''),
                        });
                        setTemplate(null);
                      }}
                    >
                      {builtinRecipes.some((b) => b.id === r.id) ? 'Remix' : 'Edit'}
                    </button>
                    {config.recipes.some((b) => b.id === r.id) && (
                      <button
                        className="button ghost"
                        disabled={busy}
                        onClick={() => {
                          if (confirm('Remove this custom recipe?'))
                            void save({ ...config, recipes: config.recipes.filter((x) => x.id !== r.id) });
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </article>
              ))}
      </div>
      {(template || recipe) && (
        <section className="card form-card studio-compose">
          <h2>{template ? 'Edit template' : 'Edit recipe'}</h2>
          <label className="field">
            <span>Name</span>
            <input
              value={template?.name ?? recipe?.name ?? ''}
              maxLength={100}
              onChange={(e) =>
                template
                  ? setTemplate({ ...template, name: e.target.value })
                  : setRecipe({ ...recipe!, name: e.target.value })
              }
            />
          </label>
          {template ? (
            <>
              <label className="field">
                <span>Instructions · purpose, audience and style</span>
                <textarea
                  value={template.instructions}
                  maxLength={3000}
                  onChange={(e) => setTemplate({ ...template, instructions: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Section headings · one per line</span>
                <textarea value={headings} onChange={(e) => setHeadings(e.target.value)} maxLength={1500} />
              </label>
            </>
          ) : (
            <>
              <label className="field">
                <span>Prompt</span>
                <textarea
                  value={recipe!.prompt}
                  maxLength={4000}
                  onChange={(e) => setRecipe({ ...recipe!, prompt: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Scope</span>
                <select
                  value={recipe!.scope}
                  onChange={(e) => setRecipe({ ...recipe!, scope: e.target.value as Recipe['scope'] })}
                >
                  <option value="single">One meeting</option>
                  <option value="multiple">Across meetings</option>
                </select>
              </label>
            </>
          )}
          <div className="inline-actions">
            <button
              className="button primary"
              disabled={busy || !state.ready}
              onClick={async () => {
                setError('');
                try {
                  const next = template
                    ? {
                        ...config,
                        templates: [
                          ...config.templates.filter((x) => x.id !== template.id),
                          {
                            ...template,
                            sections: headings
                              .split('\n')
                              .map((x) => x.trim())
                              .filter(Boolean),
                          },
                        ],
                      }
                    : { ...config, recipes: [...config.recipes.filter((x) => x.id !== recipe!.id), recipe!] };
                  validStudio(next);
                  await state.save(next);
                  setTemplate(null);
                  setRecipe(null);
                  notify('Playbook saved');
                } catch (e) {
                  setError(errorText(e));
                }
              }}
            >
              Save {template ? 'template' : 'recipe'}
            </button>
            <button
              className="button ghost"
              onClick={() => {
                setTemplate(null);
                setRecipe(null);
              }}
            >
              Cancel
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
export function MeetingChat({
  notes,
  configured,
  initialScope,
  onOpen,
  notify,
}: {
  notes: Note[];
  configured: boolean;
  initialScope?: ChatScope;
  onOpen: (id: string) => void;
  notify: (s: string) => void;
}) {
  const { config } = useStudioConfig(),
    [scope, setScope] = useState<ChatScope>(initialScope || {}),
    [ids, setIds] = useState<string[]>([]),
    [question, setQuestion] = useState(''),
    [recipeId, setRecipeId] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [messages, setMessages] = useState<
      { role: 'user' | 'assistant'; text: string; sources?: EvidenceSource[]; coverage?: any }[]
    >([]);
  const folders = [...new Set(notes.flatMap(noteFolders))].sort(),
    people = peopleDirectory(notes),
    scoped = scopeNotes(notes, [], scope),
    recipes = [...builtinRecipes, ...config.recipes],
    scopeRef = useRef('');
  const identity = JSON.stringify({ scope, ids });
  scopeRef.current = identity;
  useEffect(() => {
    setMessages([]);
    setError('');
  }, [identity]);
  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const requested = identity,
      text = question.trim(),
      label = recipeId
        ? (recipes.find((r) => r.id === recipeId)?.name || 'Recipe') + (text ? ' · ' + text : '')
        : text;
    try {
      const r = await runtime('ai', {
        kind: recipeId ? 'recipe' : 'ask',
        recipeId,
        noteIds: ids,
        text,
        instruction: '',
        scope,
        history: (messages.some((m) => m.sources?.some((s) => !scoped.some((n) => n.id === s.id)))
          ? []
          : messages
        )
          .slice(-6)
          .map((m) => ({ role: m.role, text: m.text.slice(0, 12000) })),
      });
      if (scopeRef.current === requested) {
        setMessages((old) => [...old, { role: 'user', text: label }, { role: 'assistant', ...r }].slice(-24));
        setQuestion('');
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const saveChat = async () => {
    try {
      const now = Date.now();
      await runtime('notes.save', {
        note: {
          id: newId(),
          title: 'Conversation · ' + new Date().toLocaleDateString(),
          kind: 'scratchpad',
          createdAt: now,
          updatedAt: now,
          folder: 'Saved chats',
          body: messages.map((m) => m.role.toUpperCase() + '\n' + m.text).join('\n\n'),
          summary: '',
          segments: [],
          speakers: {},
          eventId: '',
          status: 'draft',
          duration: 0,
        },
      });
      window.dispatchEvent(new Event('flow-notes-changed'));
      notify('Conversation saved as a scratchpad');
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <div className="ask-layout">
      <section className="card form-card">
        <h2>Choose your evidence.</h2>
        <p>
          Search your saved meetings, a folder, a person or a company. Choose individual notes for a focused
          answer.
        </p>
        <label className="field">
          <span>Folder</span>
          <select
            disabled={busy}
            value={scope.folder || ''}
            onChange={(e) => {
              setScope({ ...scope, folder: e.target.value });
              setIds([]);
            }}
          >
            <option value="">All folders</option>
            {folders.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Person</span>
          <select
            disabled={busy}
            value={scope.person || ''}
            onChange={(e) => {
              setScope({ ...scope, person: e.target.value });
              setIds([]);
            }}
          >
            <option value="">Everyone</option>
            {people.map((p) => (
              <option key={p.email}>{p.email}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Company email domain</span>
          <select
            disabled={busy}
            value={scope.company || ''}
            onChange={(e) => {
              setScope({ ...scope, company: e.target.value });
              setIds([]);
            }}
          >
            <option value="">All domains</option>
            {[...new Set(people.map((p) => p.company))].sort().map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <div className="studio-grid">
          <label className="field">
            <span>From</span>
            <input
              type="date"
              disabled={busy}
              onChange={(e) => {
                setScope({ ...scope, after: e.target.value ? Date.parse(e.target.value) : undefined });
                setIds([]);
              }}
            />
          </label>
          <label className="field">
            <span>Through</span>
            <input
              type="date"
              disabled={busy}
              onChange={(e) => {
                setScope({
                  ...scope,
                  before: e.target.value ? Date.parse(e.target.value) + 86400000 - 1 : undefined,
                });
                setIds([]);
              }}
            />
          </label>
        </div>
        <div className="ask-note-picker">
          {scoped.map((n) => (
            <label key={n.id}>
              <input
                type="checkbox"
                disabled={busy}
                checked={ids.includes(n.id)}
                onChange={(e) =>
                  setIds((old) => (e.target.checked ? [...old, n.id] : old.filter((x) => x !== n.id)))
                }
              />
              <span>{n.title}</span>
            </label>
          ))}
        </div>
        <p className="small-print">
          {ids.length ? `${ids.length} selected` : `${scoped.length} notes in scope`}. Keyword matching and
          recency choose up to 24 meetings, with bounded excerpts. Coverage appears below each answer. Live
          catch-up uses chunks already saved.
        </p>
      </section>
      <section className="card ask-chat">
        <div className="card-heading">
          <div>
            <Sparkles size={24} />
            <h2>Ask, remember, act.</h2>
          </div>
          <button
            className="button ghost"
            disabled={busy}
            onClick={() => {
              setMessages([]);
              setError('');
            }}
          >
            New chat
          </button>
        </div>
        {!messages.length && <p>Try “Which commitments are still open?” or use a recipe below.</p>}
        {messages.map((m, i) => (
          <article className={'chat-turn ' + m.role} key={i}>
            <span className="eyebrow">{m.role === 'user' ? 'YOU' : 'FLOW'}</span>
            <pre>
              {m.text.replace(
                /\[note:([\w-]+)\]/g,
                (_, id) => '[' + (m.sources?.find((s) => s.id === id)?.title || 'Unverified source') + ']',
              )}
            </pre>
            {m.sources && (
              <>
                <p className="small-print">
                  {m.coverage.used} of {m.coverage.matched} matching meetings supplied
                  {m.coverage.excerpted ? ' · excerpts selected' : ''}
                  {m.coverage.semanticIndexed !== undefined
                    ? ' · semantic index covers ' + m.coverage.semanticIndexed + ' meetings'
                    : ''}
                  .
                </p>
                <Sources text={m.text} sources={m.sources} onOpen={onOpen} />
              </>
            )}
          </article>
        ))}
        {error && (
          <p className="notice warning" role="alert">
            {error}
          </p>
        )}
        <form onSubmit={run}>
          <label className="field">
            <span>Recipe · optional</span>
            <select value={recipeId} onChange={(e) => setRecipeId(e.target.value)}>
              <option value="">Ask your own question</option>
              {recipes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.scope === 'single' ? ' · one note' : ''}
                </option>
              ))}
            </select>
          </label>
          <textarea
            value={question}
            maxLength={4000}
            onChange={(e) => {
              if (e.target.value === '/') {
                setRecipeId(recipes[0].id);
                setQuestion('');
              } else setQuestion(e.target.value);
            }}
            aria-label="Ask about your meetings"
            placeholder={
              recipeId ? 'Optional additional question…' : 'Ask a question, or type / for a recipe…'
            }
          />
          <button
            className="button primary"
            disabled={busy || !configured || !scoped.length || (!recipeId && !question.trim())}
          >
            {busy ? 'Reading the evidence…' : 'Ask your notes'}
          </button>
        </form>
        {!configured && <p className="small-print">Connect OpenAI in settings to run chat and recipes.</p>}
        {messages.length > 0 && (
          <button className="button ghost" onClick={() => void saveChat()}>
            Save conversation as a note
          </button>
        )}
        <p className="small-print">
          Chat history stays in this view until you save it. Changing scope starts a new conversation.
        </p>
      </section>
    </div>
  );
}
export function PeoplePanel({
  notes,
  onOpen,
  onAsk,
}: {
  notes: Note[];
  onOpen: (id: string) => void;
  onAsk: (scope: ChatScope) => void;
}) {
  const [tab, setTab] = useState('people'),
    [query, setQuery] = useState('');
  const people = peopleDirectory(notes),
    companies = [...new Set(people.map((p) => p.company))].sort();
  return (
    <>
      <section className="card form-card">
        <span className="eyebrow">THE PEOPLE BEHIND THE MEETINGS</span>
        <h2>People & companies</h2>
        <p>
          Meeting history organised by the attendees saved with your notes. Company grouping uses email
          domains; profiles are not enriched from external services.
        </p>
        <div className="notes-toolbar">
          <button
            className={'button ' + (tab === 'people' ? 'primary' : 'secondary')}
            onClick={() => setTab('people')}
          >
            People ({people.length})
          </button>
          <button
            className={'button ' + (tab === 'companies' ? 'primary' : 'secondary')}
            onClick={() => setTab('companies')}
          >
            Companies ({companies.length})
          </button>
          <input
            aria-label="Find person or company"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search email or domain…"
          />
        </div>
      </section>
      <div className="playbook-grid">
        {(tab === 'people'
          ? people.map((p) => ({ key: p.email, ids: p.notes, last: p.last }))
          : companies.map((c) => {
              const matching = people.filter((p) => p.company === c);
              return {
                key: c,
                ids: [...new Set(matching.flatMap((p) => p.notes))],
                last: Math.max(...matching.map((p) => p.last)),
              };
            })
        )
          .filter((p) => p.key.includes(query.toLowerCase()))
          .map((p) => (
            <article className="card playbook-card" key={p.key}>
              <h3>{p.key}</h3>
              <p>
                {p.ids.length} meeting(s) · latest {new Date(p.last).toLocaleDateString()}
              </p>
              <button
                className="button secondary"
                onClick={() => onAsk(tab === 'people' ? { person: p.key } : { company: p.key })}
              >
                <Sparkles size={14} />
                Ask about {tab === 'people' ? 'this person' : 'this company'}
              </button>
              <details>
                <summary>Meeting history</summary>
                {notes
                  .filter((n) => p.ids.includes(n.id))
                  .sort((a, b) => b.createdAt - a.createdAt)
                  .map((n) => (
                    <button className="directory-note" key={n.id} onClick={() => onOpen(n.id)}>
                      <span>{n.title}</span>
                      <small>{new Date(n.createdAt).toLocaleDateString()}</small>
                      <ArrowUpRight size={14} />
                    </button>
                  ))}
              </details>
            </article>
          ))}
      </div>
      {!people.length && (
        <div className="card form-card">
          <h3>Your meeting history will appear here.</h3>
          <p>Prepare a note from a calendar event, or add attendee emails in a note’s meeting toolkit.</p>
        </div>
      )}
    </>
  );
}
export function TrashPanel({
  notes,
  onRefresh,
  notify,
}: {
  notes: Note[];
  onRefresh: () => Promise<unknown>;
  notify: (s: string) => void;
}) {
  const [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  const act = async (n: Note, permanent: boolean) => {
    if (
      permanent &&
      !confirm(
        'Permanently delete “' +
          n.title +
          '”? This removes its saved note and local audio. Existing exported copies are separate.',
      )
    )
      return;
    setBusy(n.id);
    setError('');
    try {
      if (permanent) await runtime('notes.delete', { id: n.id, baseUpdatedAt: n.updatedAt });
      else
        await runtime('notes.save', {
          note: { ...n, details: { ...noteDetails(n), trashedAt: 0 } },
          baseUpdatedAt: n.updatedAt,
        });
      await onRefresh();
      notify(permanent ? 'Note permanently deleted' : 'Note restored');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  };
  return (
    <section className="card form-card">
      <h2>Trash</h2>
      <p>
        Restore notes within 30 days. Older trashed notes are removed when the workspace next runs
        maintenance. A shorter workspace retention policy still applies.
      </p>
      {error && <p className="notice warning">{error}</p>}
      {!notes.some(isTrashed) && <p className="empty-inline">Trash is empty.</p>}
      {notes.filter(isTrashed).map((n) => (
        <article className="trash-row" key={n.id}>
          <div>
            <strong>{n.title}</strong>
            <small>
              Moved {new Date(noteDetails(n).trashedAt).toLocaleDateString()} ·{' '}
              {Math.max(0, 30 - Math.floor((Date.now() - noteDetails(n).trashedAt) / 86400000))} days
              remaining
            </small>
          </div>
          <button className="button secondary" disabled={!!busy} onClick={() => void act(n, false)}>
            Restore
          </button>
          <button className="button danger" disabled={!!busy} onClick={() => void act(n, true)}>
            Delete permanently
          </button>
        </article>
      ))}
    </section>
  );
}
