'use client';
// Quick capture: a to-do by default, read from plain words ("tomorrow 4 pm #Falcon !"); choosing a
// time below makes it a reminder instead.
import { useId, useState, type FormEvent } from 'react';
import { BellRing, CircleCheck, Plus } from 'lucide-react';
import { assistant } from '../shared/client';
import { REPEATS, REPEAT_LABELS, type Repeat, type Todo } from '../shared/types';
import { useAssistant } from './context';
import { InlineError } from './Bits';
import { errorMessage, formatWhen, fromIst, nowMs, todayIst, addDaysIso } from './lib';

// The reminder time for a time with an optional date: today if still ahead, otherwise tomorrow.
export function reminderTime(date: string, time: string, now = Date.now()) {
  if (date) return fromIst(date, time);
  const today = fromIst(todayIst(now), time);
  return today > now ? today : fromIst(addDaysIso(todayIst(now), 1), time);
}

// "today", "tomorrow, 4:00 pm" or "on 27 Oct", for use inside a sentence.
export function dueWords(ms: number) {
  const w = formatWhen(ms);
  return /^(Today|Tomorrow|Yesterday)/.test(w) ? w[0].toLowerCase() + w.slice(1) : 'on ' + w;
}

export const QUICK_ADD_EXAMPLE = 'Send Rahul the valuation note tomorrow 4 pm #Falcon !';

// Natural-language add with a one-step undo (undo deletes the to-do just added).
export function useQuickAdd({
  onAdded,
  onUndone,
}: {
  onAdded?: (t: Todo) => void;
  onUndone?: (t: Todo) => void;
}) {
  const { notify } = useAssistant();
  const [last, setLast] = useState<{ todo: Todo; understood: string } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState('');
  const add = async (text: string) => {
    const r = await assistant('todo.quickAdd', { text });
    setLast(r);
    setUndoError('');
    onAdded?.(r.todo);
    return r;
  };
  const undo = async () => {
    if (!last) return;
    setUndoing(true);
    setUndoError('');
    try {
      await assistant('todo.delete', { id: last.todo.id });
      onUndone?.(last.todo);
      notify('To-do removed');
      setLast(null);
    } catch (e) {
      setUndoError(errorMessage(e));
    } finally {
      setUndoing(false);
    }
  };
  return { last, add, undo, undoing, undoError, clear: () => setLast(null) };
}

// How the last quick add was read, with Undo.
export function Understood({ quick }: { quick: ReturnType<typeof useQuickAdd> }) {
  if (!quick.last) return null;
  return (
    <div className="as-understood">
      <CircleCheck size={16} aria-hidden="true" />
      <p>
        <strong>Added: {quick.last.todo.title}.</strong> {quick.last.understood}
      </p>
      <button
        type="button"
        className="wf-link as-tap"
        onClick={() => void quick.undo()}
        disabled={quick.undoing}
        aria-label={'Undo: remove ' + quick.last.todo.title}
      >
        {quick.undoing ? 'Undoing' : 'Undo'}
      </button>
      <InlineError message={quick.undoError} />
    </div>
  );
}

export function QuickCapture({ onAdded }: { onAdded?: (kind: 'todo' | 'reminder') => void }) {
  const { notify } = useAssistant();
  const id = useId();
  const quick = useQuickAdd({ onUndone: () => onAdded?.('todo') });
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [repeat, setRepeat] = useState<Repeat>('once');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const isReminder = !!time;
  const when = isReminder ? reminderTime(date, time) : date ? fromIst(date, '23:59') : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = title.trim();
    if (!text) {
      setError('Type what you want to remember.');
      return;
    }
    if (isReminder && when! <= nowMs()) {
      setError('Choose a time in the future.');
      return;
    }
    setBusy(true);
    setError('');
    setStatus('');
    quick.clear();
    try {
      if (isReminder) {
        const r = await assistant('reminder.create', { reminder: { title: text, dueAt: when!, repeat } });
        const msg = `Reminder set for ${formatWhen(r.dueAt)}.`;
        setStatus(msg);
        notify(msg);
      } else if (date) {
        // A chosen date is taken as it is; the words are the title.
        await assistant('todo.create', {
          todo: { title: text, details: '', priority: 'normal', dueAt: when },
        });
        setStatus('To-do added.');
        notify('To-do added');
      } else {
        await quick.add(text);
        notify('To-do added');
      }
      setTitle('');
      setDate('');
      setTime('');
      setRepeat('once');
      onAdded?.(isReminder ? 'reminder' : 'todo');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="as-capture" onSubmit={submit} aria-label="Add a to-do or reminder">
      <label htmlFor={id + '-t'} className="as-capture-label">
        Add a to-do or reminder
      </label>
      <div className="as-capture-main">
        <input
          id={id + '-t'}
          className="wf-input"
          value={title}
          maxLength={300}
          placeholder={'For example, ' + QUICK_ADD_EXAMPLE}
          onChange={(e) => setTitle(e.target.value)}
          autoComplete="off"
        />
        <button type="submit" className="button primary" disabled={busy}>
          {isReminder ? <BellRing size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
          {busy ? 'Adding' : isReminder ? 'Set reminder' : 'Add to-do'}
        </button>
      </div>
      <div className="as-capture-when">
        <label>
          <span>Date</span>
          <input type="date" className="wf-input" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          <span>Time</span>
          <input type="time" className="wf-input" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        {isReminder && (
          <label>
            <span>Repeat</span>
            <select className="wf-input" value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)}>
              {REPEATS.map((r) => (
                <option key={r} value={r}>
                  {REPEAT_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div aria-live="polite">
        {quick.last && !title ? (
          <Understood quick={quick} />
        ) : (
          <p className="as-capture-hint">
            {status && !title
              ? status
              : isReminder
                ? `A reminder for ${formatWhen(when!)}, India time.`
                : date
                  ? `A to-do due ${dueWords(when!)}. Add a time to make it a reminder.`
                  : 'A to-do. Dates and times in your words, #list and ! for high priority are understood. Choose a time below for a reminder instead.'}
          </p>
        )}
      </div>
      <InlineError message={error} />
    </form>
  );
}
