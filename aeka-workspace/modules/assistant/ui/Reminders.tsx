'use client';
// Reminders: one-time or recurring, in India time; pause, resume, snooze, edit and delete.
import { useId, useState, type FormEvent } from 'react';
import { AlarmClock, BellRing, Pause, Pencil, Play, Trash2 } from 'lucide-react';
import { assistant } from '../shared/client';
import type { ReminderInput } from '../shared/contract';
import { REPEATS, REPEAT_LABELS, type Reminder, type Repeat } from '../shared/types';
import { Modal } from '../../workflow/ui/components/Modal';
import { ConfirmButton } from '../../workflow/ui/components/ConfirmButton';
import { Empty } from '../../workflow/ui/components/Bits';
import { Field } from '../../workflow/ui/components/Inputs';
import { useAssistant, useTickChange } from './context';
import { InlineError, LoadError, Loading } from './Bits';
import { reminderTime } from './QuickCapture';
import {
  CONFLICT,
  errorMessage,
  formatWhen,
  isConflict,
  istParts,
  minutesToTomorrowNine,
  useLoad,
} from './lib';

const SNOOZES = [
  { label: '15 min', minutes: () => 15 },
  { label: '1 hour', minutes: () => 60 },
  { label: 'Tomorrow 9 am', minutes: () => minutesToTomorrowNine() },
];

function RepeatSelect({ value, onChange, id }: { value: Repeat; onChange: (r: Repeat) => void; id?: string }) {
  return (
    <select id={id} className="wf-input" value={value} onChange={(e) => onChange(e.target.value as Repeat)}>
      {REPEATS.map((r) => (
        <option key={r} value={r}>
          {REPEAT_LABELS[r]}
        </option>
      ))}
    </select>
  );
}

function ReminderEditor({
  reminder,
  onClose,
  onSaved,
  onConflict,
}: {
  reminder: Reminder;
  onClose: () => void;
  onSaved: (r: Reminder) => void;
  onConflict: () => void;
}) {
  const { notify } = useAssistant();
  const start = istParts(reminder.dueAt);
  const [title, setTitle] = useState(reminder.title);
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [repeat, setRepeat] = useState<Repeat>(reminder.repeat);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError('A reminder needs a title.');
    if (!time) return setError('Choose a time.');
    const dueAt = reminderTime(date, time);
    if (dueAt <= Date.now()) return setError('Choose a time in the future.');
    setBusy(true);
    setError('');
    try {
      const input: ReminderInput = {
        title: title.trim(),
        dueAt,
        repeat,
        status: reminder.status === 'paused' ? 'paused' : 'active',
      };
      onSaved(await assistant('reminder.update', { id: reminder.id, reminder: input, baseRevision: reminder.revision }));
      notify('Reminder saved');
      onClose();
    } catch (err) {
      if (isConflict(err)) {
        onConflict();
        onClose();
      } else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Edit reminder"
      onClose={onClose}
      footer={
        <div className="wf-form-actions as-actions-end">
          <button type="button" className="button ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="as-reminder-edit" className="button primary" disabled={busy}>
            {busy ? 'Saving' : 'Save'}
          </button>
        </div>
      }
    >
      <form id="as-reminder-edit" onSubmit={save}>
        <Field label="Remind me to">
          <input value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} data-autofocus />
        </Field>
        <div className="as-two">
          <Field label="Date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Time (India time)">
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
          </Field>
        </div>
        <Field label="Repeat">
          <RepeatSelect value={repeat} onChange={setRepeat} />
        </Field>
        <InlineError message={error} />
      </form>
    </Modal>
  );
}

function AddReminder({ onAdded }: { onAdded: (r: Reminder) => void }) {
  const id = useId();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [repeat, setRepeat] = useState<Repeat>('once');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError('Type what to remind you about.');
    if (!time) return setError('Choose a time for the reminder.');
    const dueAt = reminderTime(date, time);
    if (dueAt <= Date.now()) return setError('Choose a time in the future.');
    setBusy(true);
    setError('');
    try {
      onAdded(await assistant('reminder.create', { reminder: { title: title.trim(), dueAt, repeat } }));
      setTitle('');
      setDate('');
      setTime('');
      setRepeat('once');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="as-add" onSubmit={submit} aria-label="Add a reminder">
      <div className="as-add-row">
        <label htmlFor={id} className="wf-sr">
          New reminder
        </label>
        <input
          id={id}
          className="wf-input"
          value={title}
          maxLength={300}
          placeholder="Remind me to"
          autoComplete="off"
          onChange={(e) => setTitle(e.target.value)}
        />
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? 'Adding' : 'Add'}
        </button>
      </div>
      <div className="as-add-row small">
        <label className="as-mini">
          <span>Date</span>
          <input type="date" className="wf-input" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="as-mini">
          <span>Time</span>
          <input type="time" className="wf-input" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <label className="as-mini">
          <span>Repeat</span>
          <RepeatSelect value={repeat} onChange={setRepeat} />
        </label>
      </div>
      <p className="as-capture-hint">
        {time
          ? `First reminder ${formatWhen(reminderTime(date, time))}, India time.`
          : 'Times are India time. Without a date, the next time that comes is used.'}
      </p>
      <InlineError message={error} />
    </form>
  );
}

function ReminderItem({
  r,
  onPause,
  onSnooze,
  onEdit,
  onDelete,
}: {
  r: Reminder;
  onPause: () => void;
  onSnooze: (minutes: number, label: string) => void;
  onEdit: () => void;
  onDelete: () => Promise<unknown>;
}) {
  const [snoozing, setSnoozing] = useState(false);
  const paused = r.status === 'paused';
  const finished = r.status === 'done';
  const late = !paused && !finished && r.dueAt < Date.now();
  return (
    <li className={'as-item reminder' + (paused || finished ? ' muted' : '')}>
      <span className="as-item-icon" aria-hidden="true">
        <BellRing size={16} />
      </span>
      <div className="as-item-main">
        <p className="as-item-title">{r.title}</p>
        <p className="as-item-meta">
          {finished ? (
            <span>Finished{r.lastFiredAt ? ', last ' + formatWhen(r.lastFiredAt) : ''}</span>
          ) : paused ? (
            <span className="as-tag">Paused</span>
          ) : (
            <span className={late ? 'wf-overdue' : 'as-next'}>
              {late ? 'Due ' : 'Next: '}
              {formatWhen(r.dueAt)}
            </span>
          )}
          {r.repeat !== 'once' && <span>{REPEAT_LABELS[r.repeat]}</span>}
        </p>
        {snoozing && (
          <div className="as-snooze" role="group" aria-label={'Snooze ' + r.title}>
            {SNOOZES.map((s) => (
              <button
                key={s.label}
                type="button"
                className="wf-chip"
                onClick={() => {
                  setSnoozing(false);
                  onSnooze(s.minutes(), s.label);
                }}
              >
                {s.label}
              </button>
            ))}
            <button type="button" className="button ghost small" onClick={() => setSnoozing(false)}>
              Cancel
            </button>
          </div>
        )}
      </div>
      <div className="as-item-actions">
        {!finished && !paused && (
          <button
            type="button"
            className="wf-icon-btn as-tap"
            aria-label={'Snooze ' + r.title}
            aria-expanded={snoozing}
            title="Snooze"
            onClick={() => setSnoozing((v) => !v)}
          >
            <AlarmClock size={16} />
          </button>
        )}
        {!finished && (
          <button
            type="button"
            className="wf-icon-btn as-tap"
            aria-label={(paused ? 'Resume ' : 'Pause ') + r.title}
            title={paused ? 'Resume' : 'Pause'}
            onClick={onPause}
          >
            {paused ? <Play size={16} /> : <Pause size={16} />}
          </button>
        )}
        <button type="button" className="wf-icon-btn as-tap" aria-label={'Edit ' + r.title} onClick={onEdit}>
          <Pencil size={16} />
        </button>
        <ConfirmButton className="wf-icon-btn as-tap" ariaLabel={'Delete ' + r.title} question="Delete?" onConfirm={onDelete}>
          <Trash2 size={16} />
        </ConfirmButton>
      </div>
    </li>
  );
}

export function ReminderSection() {
  const { notify } = useAssistant();
  const list = useLoad(() => assistant('reminders.list', {}));
  const [editing, setEditing] = useState<Reminder | null>(null);
  const [status, setStatus] = useState('');
  // Fired reminders advance on each tick.
  useTickChange(list.reload);
  const put = (r: Reminder) =>
    list.set((items) => (items.some((x) => x.id === r.id) ? items.map((x) => (x.id === r.id ? r : x)) : [...items, r]));
  const failed = (e: unknown) => {
    if (isConflict(e)) {
      notify(CONFLICT);
      void list.reload();
    } else notify(errorMessage(e));
  };
  const togglePause = async (r: Reminder) => {
    const next = r.status === 'paused' ? 'active' : 'paused';
    // A reminder resumed after its time has passed moves to the next time that clock time comes round.
    let dueAt = r.dueAt;
    if (next === 'active' && dueAt <= Date.now()) dueAt = reminderTime('', istParts(dueAt).time);
    try {
      const saved = await assistant('reminder.update', {
        id: r.id,
        baseRevision: r.revision,
        reminder: { title: r.title, dueAt, repeat: r.repeat, status: next },
      });
      put(saved);
      setStatus(next === 'paused' ? `Paused: ${r.title}` : `Resumed: ${r.title}, next ${formatWhen(saved.dueAt)}`);
    } catch (e) {
      failed(e);
    }
  };
  const snooze = async (r: Reminder, minutes: number) => {
    try {
      const saved = await assistant('reminder.snooze', { id: r.id, minutes, baseRevision: r.revision });
      put(saved);
      notify(`Snoozed until ${formatWhen(saved.dueAt)}`);
    } catch (e) {
      failed(e);
    }
  };
  const remove = async (r: Reminder) => {
    try {
      await assistant('reminder.delete', { id: r.id });
      list.set((items) => items.filter((x) => x.id !== r.id));
      setStatus(`Deleted: ${r.title}`);
    } catch (e) {
      notify(errorMessage(e));
    }
  };

  if (list.phase === 'loading') return <Loading>Loading your reminders</Loading>;
  if (list.phase === 'error' || !list.data)
    return <LoadError title="Your reminders could not be loaded" message={list.error} status={list.status} onRetry={list.retry} />;
  const live = list.data.filter((r) => r.status !== 'done').sort((a, b) => a.dueAt - b.dueAt);
  const finished = list.data.filter((r) => r.status === 'done').sort((a, b) => b.updatedAt - a.updatedAt);
  const item = (r: Reminder) => (
    <ReminderItem
      key={r.id}
      r={r}
      onPause={() => void togglePause(r)}
      onSnooze={(m) => void snooze(r, m)}
      onEdit={() => setEditing(r)}
      onDelete={() => remove(r)}
    />
  );
  return (
    <div className="as-stack">
      <AddReminder
        onAdded={(r) => {
          put(r);
          setStatus(`Reminder set for ${formatWhen(r.dueAt)}`);
          notify(`Reminder set for ${formatWhen(r.dueAt)}`);
        }}
      />
      <p className="wf-sr" aria-live="polite">
        {status}
      </p>
      <InlineError message={list.error} onRetry={list.retry} />
      {live.length === 0 ? (
        <Empty icon={AlarmClock} title="No reminders set">
          Add one above, or ask Aeka, for example: remind me every Monday at 10 am to review billing.
        </Empty>
      ) : (
        <ul className="as-items" aria-label="Reminders">
          {live.map(item)}
        </ul>
      )}
      {finished.length > 0 && (
        <details className="as-done">
          <summary>Finished ({finished.length})</summary>
          <ul className="as-items" aria-label="Finished reminders">
            {finished.slice(0, 50).map(item)}
          </ul>
        </details>
      )}
      {editing && (
        <ReminderEditor
          reminder={editing}
          onClose={() => setEditing(null)}
          onSaved={put}
          onConflict={() => {
            notify(CONFLICT);
            void list.reload();
          }}
        />
      )}
    </div>
  );
}
