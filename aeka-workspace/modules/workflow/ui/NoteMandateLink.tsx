'use client';
// Workflow's panel on an open Scribe note: link the note to mandates, update the shared copy, choose
// whether the transcript is shared, or remove the link. Shown only to firm members; loaded lazily.
import { useEffect, useState } from 'react';
import { ArrowUpRight, BriefcaseBusiness, Link2, Lock, RefreshCw, Unlink } from 'lucide-react';
import { handOver } from '../../../core/client/handover';
import type { SlotProps } from '../../../core/client/module';
import type { WorkflowActions } from '../shared/contract';
import { wf } from '../shared/client';
import type { MeetingTarget } from '../shared/types';
import { errorMessage, errorStatus, formatStamp, plural } from './lib';
import './note-link.css';

type Linked = WorkflowActions['meetings.forNote']['result'][number];

interface Loaded {
  state: { links: Linked[]; targets: MeetingTarget[] } | 'hidden';
  error?: string;
}
async function fetchLinks(noteId: string): Promise<Loaded> {
  try {
    const [links, targets] = await Promise.all([
      wf('meetings.forNote', { noteId }),
      wf('meetings.targets', {}),
    ]);
    return { state: { links, targets } };
  } catch (e) {
    // Not a firm member (or not signed in): this panel does not apply.
    const status = errorStatus(e);
    if (status === 401 || status === 403) return { state: 'hidden' };
    return { state: { links: [], targets: [] }, error: errorMessage(e) };
  }
}

// A fresh panel for each note, so nothing from the previous note carries over.
export default function NoteMandateLink(props: SlotProps['scribe.note']) {
  return <Panel key={props.note.id} {...props} />;
}

function Panel({ note, unsaved, save, navigate, notify }: SlotProps['scribe.note']) {
  const [state, setState] = useState<{ links: Linked[]; targets: MeetingTarget[] } | 'hidden' | null>(null);
  const [adding, setAdding] = useState(false);
  const [matterId, setMatterId] = useState('');
  const [withTranscript, setWithTranscript] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const apply = (r: Loaded) => {
    setState(r.state);
    if (r.error) setError(r.error);
  };
  const load = async () => apply(await fetchLinks(note.id));
  useEffect(() => {
    let alive = true;
    void fetchLinks(note.id).then((r) => alive && apply(r));
    return () => {
      alive = false;
    };
  }, [note.id]);

  if (state === null || state === 'hidden') return null;
  const { links, targets } = state;
  const linkedIds = new Set(links.map((l) => l.matterId));
  const available = targets.filter((t) => !linkedIds.has(t.matterId));
  const hasTranscript = note.kind === 'meeting' && note.segments > 0;

  // Sharing reads the saved note, so unsaved edits are saved first.
  const share = async (target: string, transcript: boolean, label: string) => {
    setBusy(label);
    setError('');
    try {
      if (unsaved) await save();
      await wf('meetings.link', { noteId: note.id, matterId: target, includeTranscript: transcript });
      await load();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy('');
    }
  };
  const unlink = async (link: Linked) => {
    if (!confirm(`Remove this note from ${link.matterTitle}? Tasks already created from it stay.`)) return;
    setBusy('unlink:' + link.id);
    setError('');
    try {
      await wf('meetings.unlink', { id: link.id });
      notify('Note removed from the mandate');
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
    }
  };
  const openMandate = (id: string) => {
    handOver('workflow.matter', { matterId: id, tab: 'meetings' });
    navigate('workflow/matters');
  };
  const byClient = available.reduce<Record<string, MeetingTarget[]>>((acc, t) => {
    (acc[t.clientName] ??= []).push(t);
    return acc;
  }, {});

  return (
    <section className="note-mandates" aria-labelledby={'note-mandates-' + note.id}>
      <div className="note-mandates-head">
        <h3 id={'note-mandates-' + note.id}>
          <BriefcaseBusiness size={14} aria-hidden="true" /> Mandates
        </h3>
        {!adding && available.length > 0 && (
          <button type="button" className="button ghost small" onClick={() => setAdding(true)}>
            <Link2 size={14} /> Link to a mandate
          </button>
        )}
      </div>
      {links.length > 0 ? (
        <ul className="note-mandate-list">
          {links.map((l) => (
            <li key={l.id}>
              <button type="button" className="text-link" onClick={() => openMandate(l.matterId)}>
                {l.clientName}: {l.matterTitle} <ArrowUpRight size={13} aria-hidden="true" />
              </button>
              <span className="note-mandate-meta">
                Shared {formatStamp(l.updatedAt)} · {plural(l.actions.length, 'action item')}
                {l.actions.some((a) => a.taskId) &&
                  ` (${l.actions.filter((a) => a.taskId).length} with tasks)`}
              </span>
              <div className="note-mandate-actions">
                {hasTranscript && (
                  <label className="note-mandate-check">
                    <input
                      type="checkbox"
                      checked={l.includeTranscript}
                      disabled={!!busy}
                      onChange={(e) =>
                        void share(l.matterId, e.target.checked, 'transcript:' + l.id).then(
                          (ok) =>
                            ok &&
                            notify(e.target.checked ? 'Transcript shared' : 'Transcript no longer shared'),
                        )
                      }
                    />
                    Transcript shared
                  </label>
                )}
                <button
                  type="button"
                  className="button ghost small"
                  disabled={!!busy}
                  onClick={() =>
                    void share(l.matterId, l.includeTranscript, 'update:' + l.id).then(
                      (ok) => ok && notify('Shared copy updated'),
                    )
                  }
                >
                  <RefreshCw size={13} /> {busy === 'update:' + l.id ? 'Updating' : 'Update shared copy'}
                </button>
                <button
                  type="button"
                  className="button ghost small"
                  disabled={!!busy}
                  onClick={() => void unlink(l)}
                >
                  <Unlink size={13} /> Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        !adding && (
          <p className="note-mandate-meta">
            {targets.length
              ? 'Not linked. Link this note to share its summary and action items with a mandate team.'
              : 'There are no mandates you can link this note to.'}
          </p>
        )
      )}
      {adding && (
        <form
          className="note-mandate-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!matterId) return setError('Choose a mandate.');
            void share(matterId, withTranscript, 'link').then((ok) => {
              if (!ok) return;
              notify('Note linked to the mandate');
              setAdding(false);
              setMatterId('');
              setWithTranscript(false);
            });
          }}
        >
          <label>
            <span>Mandate</span>
            <select value={matterId} onChange={(e) => setMatterId(e.target.value)} required>
              <option value="">Choose a mandate</option>
              {Object.entries(byClient).map(([client, list]) => (
                <optgroup key={client} label={client}>
                  {list.map((t) => (
                    <option key={t.matterId} value={t.matterId}>
                      {t.title}
                      {t.status === 'closed' ? ' (closed)' : ''}
                      {t.restricted ? ' (restricted)' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          {hasTranscript && (
            <label className="note-mandate-check">
              <input
                type="checkbox"
                checked={withTranscript}
                onChange={(e) => setWithTranscript(e.target.checked)}
              />
              Also share the full transcript ({plural(note.segments, 'segment')})
            </label>
          )}
          <p className="note-mandate-notice">
            <Lock size={13} aria-hidden="true" />
            <span>
              Everyone who can see the mandate will see this note&apos;s title, date, attendees, summary and{' '}
              {plural(note.actions, 'action item')}
              {withTranscript ? ', and the transcript' : ''}. Your own notes are not shared. The copy changes
              only when you update it{unsaved ? '; your unsaved edits are saved first' : ''}.
            </span>
          </p>
          <div className="note-mandate-actions">
            <button type="submit" className="button primary small" disabled={!!busy}>
              {busy === 'link' ? 'Linking' : 'Link and share'}
            </button>
            <button
              type="button"
              className="button ghost small"
              onClick={() => {
                setAdding(false);
                setError('');
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="note-mandate-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
