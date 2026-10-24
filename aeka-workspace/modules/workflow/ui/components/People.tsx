'use client';
// People: initials badge, single-person select and a team multi-select. Person keys are member emails or
// "legacy:XX" for initials imported from the earlier sheet; legacy initials are shown in grey.
import type { PersonKey } from '../../shared/types';
import { isLegacy, personLabel, rank, type Member } from '../lib';
import { useWF } from '../store';

export function PersonBadge({ person, showName }: { person: PersonKey | null; showName?: boolean }) {
  const { members } = useWF();
  const p = personLabel(person, members);
  if (!person)
    return showName ? <span className="wf-caption">Unassigned</span> : <span className="wf-badge empty">-</span>;
  return (
    <span className="wf-person" title={p.name}>
      <span className={'wf-badge' + (p.legacy ? ' legacy' : '')} aria-hidden={showName ? true : undefined}>
        {p.initials}
      </span>
      {showName ? <span>{p.name}</span> : <span className="wf-sr">{p.name}</span>}
    </span>
  );
}

export function PersonList({ people, max = 4 }: { people: PersonKey[]; max?: number }) {
  if (!people.length) return <span className="wf-caption">No team</span>;
  return (
    <span className="wf-people">
      {people.slice(0, max).map((p) => (
        <PersonBadge key={p} person={p} />
      ))}
      {people.length > max && <span className="wf-caption">+{people.length - max}</span>}
    </span>
  );
}

const sortMembers = (a: Member, b: Member) => rank(b) - rank(a) || a.name.localeCompare(b.name);

// Options for a person select: active members plus any current value that is legacy or inactive.
export function usePeopleOptions(extra: (PersonKey | null)[] = []) {
  const { members } = useWF();
  const active = members.filter((m) => m.active).sort(sortMembers);
  const known = new Set(active.map((m) => m.email));
  const others = [...new Set(extra.filter((k): k is string => !!k && !known.has(k)))];
  return [
    ...active.map((m) => ({ key: m.email, label: `${m.name} (${m.initials})` })),
    ...others.map((k) => ({ key: k, label: personLabel(k, members).name })),
  ];
}

export function PersonPicker({
  value,
  onChange,
  label,
  hideLabel,
  noneLabel = 'Unassigned',
  allowNone = true,
  only,
  disabled,
  id,
}: {
  value: PersonKey | null;
  onChange: (v: PersonKey | null) => void;
  label: string;
  hideLabel?: boolean;
  noneLabel?: string;
  allowNone?: boolean;
  only?: PersonKey[]; // restrict to these people (plus the current value)
  disabled?: boolean;
  id?: string;
}) {
  const all = usePeopleOptions([value, ...(only ?? [])]);
  const options = only ? all.filter((o) => only.includes(o.key) || o.key === value) : all;
  const select = (
    <select
      id={id}
      value={value ?? ''}
      disabled={disabled}
      aria-label={hideLabel ? label : undefined}
      onChange={(e) => onChange(e.target.value || null)}
    >
      {allowNone && <option value="">{noneLabel}</option>}
      {options.map((o) => (
        <option key={o.key} value={o.key}>
          {o.label}
        </option>
      ))}
    </select>
  );
  if (hideLabel) return select;
  return (
    <label className="wf-field">
      <span>{label}</span>
      {select}
    </label>
  );
}

export function TeamPicker({
  value,
  onChange,
  legend = 'Team',
}: {
  value: PersonKey[];
  onChange: (v: PersonKey[]) => void;
  legend?: string;
}) {
  const options = usePeopleOptions(value);
  return (
    <fieldset className="wf-fieldset">
      <legend>{legend}</legend>
      <div className="wf-check-grid">
        {options.map((o) => (
          <label key={o.key} className={'wf-check' + (isLegacy(o.key) ? ' legacy' : '')}>
            <input
              type="checkbox"
              checked={value.includes(o.key)}
              onChange={(e) =>
                onChange(e.target.checked ? [...value, o.key] : value.filter((k) => k !== o.key))
              }
            />
            <span>{o.label}</span>
          </label>
        ))}
        {!options.length && <p className="wf-caption">No members yet. Add them under Team and Access.</p>}
      </div>
    </fieldset>
  );
}
