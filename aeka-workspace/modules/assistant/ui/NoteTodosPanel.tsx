'use client';
// The Assistant's panel on an open Scribe meeting note: add the note's action items to my to-dos
// (once each, linked back to the note). Shown only to firm members, and only for meeting notes with
// action items; loaded lazily.
import { useEffect, useState } from 'react';
import { ArrowUpRight, ListTodo, Lock, Plus } from 'lucide-react';
import type { SlotProps } from '../../../core/client/module';
import { assistant } from '../shared/client';
import { core, errorMessage, errorStatus, type MeInfo } from './lib';
import './note-todos.css';

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

// How many of this note's action items are already to-dos; null when unknown.
async function fetchState(noteId: string): Promise<{ hidden: boolean; added: number | null }> {
  try {
    const me = await core<MeInfo>('me');
    if (!me.member || !me.member.active) return { hidden: true, added: null };
  } catch {
    return { hidden: true, added: null };
  }
  try {
    const todos = await assistant('todos.list', { includeDone: true });
    return {
      hidden: false,
      added: todos.filter((t) => t.source === 'meeting' && t.sourceRef.startsWith(noteId + ':')).length,
    };
  } catch (e) {
    const status = errorStatus(e);
    return { hidden: status === 401 || status === 403, added: null };
  }
}

export default function NoteTodosPanel(props: SlotProps['scribe.note']) {
  if (props.note.kind !== 'meeting' || props.note.actions < 1) return null;
  // A fresh panel for each note, so nothing from the previous note carries over.
  return <Panel key={props.note.id} {...props} />;
}

function Panel({ note, unsaved, save, navigate, notify }: SlotProps['scribe.note']) {
  const [state, setState] = useState<{ hidden: boolean; added: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    void fetchState(note.id).then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
  }, [note.id]);

  if (!state || state.hidden) return null;
  const { added } = state;
  const allAdded = added != null && added >= note.actions;

  const add = async () => {
    setBusy(true);
    setError('');
    setResult('');
    try {
      // The server reads the saved note, so unsaved edits are saved first.
      if (unsaved) await save();
      const r = await assistant('notes.toTodos', { noteId: note.id });
      const n = r.added.length;
      const msg = n
        ? `Added ${plural(n, 'to-do')}.${r.skipped ? ` ${plural(r.skipped, 'item was', 'items were')} already on your list.` : ''}`
        : 'Nothing new to add. Every action item is already on your to-dos.';
      setResult(msg);
      notify(n ? `Added ${plural(n, 'to-do')}` : 'Nothing new to add');
      setState((s) => (s ? { ...s, added: Math.max((s.added ?? 0) + n, n + r.skipped) } : s));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="note-todos" aria-labelledby={'note-todos-' + note.id}>
      <div className="note-todos-head">
        <h3 id={'note-todos-' + note.id}>
          <ListTodo size={14} aria-hidden="true" /> My to-dos
        </h3>
        <div className="note-todos-actions">
          {!allAdded && (
            <button type="button" className="button primary small" onClick={() => void add()} disabled={busy}>
              <Plus size={14} aria-hidden="true" />
              {busy ? 'Adding' : added ? 'Add the new ones' : 'Add action items to my to-dos'}
            </button>
          )}
          {(added || result) && (
            <button type="button" className="button ghost small" onClick={() => navigate('assistant/todos')}>
              Open to-dos <ArrowUpRight size={13} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      <p className="note-todos-meta" aria-live="polite">
        {result ||
          (added == null
            ? `${plural(note.actions, 'action item')} in this note.`
            : allAdded
              ? `All ${plural(note.actions, 'action item')} are on your to-dos.`
              : added
                ? `${added} of ${plural(note.actions, 'action item')} are on your to-dos.`
                : `${plural(note.actions, 'action item')} in this note. Each becomes a to-do linked back here, with its due date and owner.`)}
      </p>
      {!added && !result && (
        <p className="note-todos-private">
          <Lock size={12} aria-hidden="true" /> Only you see these to-dos. The note stays private
          {unsaved ? '; your unsaved edits are saved first' : ''}.
        </p>
      )}
      {error && (
        <p className="note-todos-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
