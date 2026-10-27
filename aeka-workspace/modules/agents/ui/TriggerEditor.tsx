'use client';
// When an agent runs: on command, on a schedule (India time) or when a workspace notice of chosen
// kinds arrives. Switching type keeps what was set for the other types, so nothing is lost by a tap.
import { useId, useState } from 'react';
import { Chips } from '../../workflow/ui/components/Bits';
import {
  EVENT_KINDS,
  EVENT_LABELS,
  REPEAT_LABELS,
  SCHEDULE_REPEATS,
  type EventKind,
  type ScheduleRepeat,
  type Trigger,
} from '../shared/types';
import { fromIstInput, MAX, nextNineAm, toIstInput, triggerLabel, triggerProblem } from './lib';

type Schedule = Extract<Trigger, { type: 'schedule' }>;
type EventTrigger = Extract<Trigger, { type: 'event' }>;
const TYPES: { id: Trigger['type']; label: string }[] = [
  { id: 'manual', label: 'On command' },
  { id: 'schedule', label: 'On a schedule' },
  { id: 'event', label: 'When something happens' },
];

export function TriggerEditor({
  value,
  onChange,
  disabled,
}: {
  value: Trigger;
  onChange: (t: Trigger) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const [kept, setKept] = useState(() => ({
    schedule:
      value.type === 'schedule'
        ? value
        : ({ type: 'schedule', repeat: 'weekdays', at: nextNineAm() } as Schedule),
    event:
      value.type === 'event'
        ? value
        : ({ type: 'event', kinds: ['mail.urgent'], contains: '' } as EventTrigger),
  }));
  const set = (t: Trigger) => {
    if (t.type === 'schedule') setKept((k) => ({ ...k, schedule: t }));
    if (t.type === 'event') setKept((k) => ({ ...k, event: t }));
    onChange(t);
  };
  const choose = (type: Trigger['type']) =>
    set(type === 'manual' ? { type: 'manual' } : type === 'schedule' ? kept.schedule : kept.event);
  const problem = triggerProblem(value);

  return (
    <fieldset className="ag-trigger wf-plain" disabled={disabled}>
      <legend className="ag-legend">When it runs</legend>
      <Chips label="When it runs" options={TYPES} value={value.type} onChange={choose} />
      {value.type === 'schedule' && <ScheduleFields value={value} onChange={set} />}
      {value.type === 'event' && (
        <div className="ag-events">
          <ul className="ag-checks" aria-label="Things that start it">
            {EVENT_KINDS.map((k) => (
              <li key={k}>
                <label className="ag-check">
                  <input
                    type="checkbox"
                    checked={value.kinds.includes(k)}
                    onChange={(e) => {
                      const kinds: EventKind[] = e.target.checked
                        ? EVENT_KINDS.filter((x) => x === k || value.kinds.includes(x))
                        : value.kinds.filter((x) => x !== k);
                      set({ ...value, kinds });
                    }}
                  />
                  <span>{EVENT_LABELS[k]}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="wf-field">
            <label htmlFor={id + '-contains'}>Only when it mentions (optional)</label>
            <input
              id={id + '-contains'}
              type="text"
              value={value.contains}
              maxLength={MAX.contains}
              placeholder="For example: Kestrel"
              onChange={(e) => set({ ...value, contains: e.target.value })}
            />
            <small>Words the notice must contain, such as a client name. Leave empty for every notice.</small>
          </div>
        </div>
      )}
      {problem ? (
        <p className="ag-problem" role="alert">
          {problem}
        </p>
      ) : (
        value.type !== 'manual' && <p className="ag-reads">{triggerLabel(value)}</p>
      )}
    </fieldset>
  );
}

function ScheduleFields({ value, onChange }: { value: Schedule; onChange: (t: Schedule) => void }) {
  const id = useId();
  // The text typed so far: a half-typed date is kept on screen until it reads as a time.
  const [text, setText] = useState(() => toIstInput(value.at));
  const parsed = fromIstInput(text);
  const shown = Number.isNaN(parsed) || parsed === value.at ? text : toIstInput(value.at);
  return (
    <div className="ag-schedule">
      <div className="wf-field">
        <label htmlFor={id + '-repeat'}>Repeat</label>
        <select
          id={id + '-repeat'}
          value={value.repeat}
          onChange={(e) => onChange({ ...value, repeat: e.target.value as ScheduleRepeat })}
        >
          {SCHEDULE_REPEATS.map((r) => (
            <option key={r} value={r}>
              {REPEAT_LABELS[r]}
            </option>
          ))}
        </select>
      </div>
      <div className="wf-field">
        <label htmlFor={id + '-at'}>{value.repeat === 'once' ? 'Date and time' : 'First run'}</label>
        <input
          id={id + '-at'}
          type="datetime-local"
          value={shown}
          aria-describedby={id + '-hint'}
          onChange={(e) => {
            setText(e.target.value);
            const at = fromIstInput(e.target.value);
            onChange({ ...value, at });
          }}
        />
        <small id={id + '-hint'}>India time.</small>
      </div>
    </div>
  );
}
