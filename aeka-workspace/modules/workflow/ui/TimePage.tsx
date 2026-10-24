'use client';
// Timesheets: log time (own, or anyone's for Assistant Managers and above), recent entries, this week's
// totals and the CSV export. Also provides the mandate Timesheet tab.
import { useState } from 'react';
import { Download, Pencil, Trash2 } from 'lucide-react';
import type { Matter, PersonKey, TimeEntry } from '../shared/types';
import { ConfirmButton } from './components/ConfirmButton';
import { Empty, TableWrap } from './components/Bits';
import { DateInput, Field } from './components/Inputs';
import { PersonBadge, PersonPicker } from './components/People';
import { addDays, download, formatDate, formatHours, formatWeekday, weekStart } from './lib';
import { useMatterLabel, useRemote, useWF } from './store';

const EDIT_DAYS = 30;

// Own entries can be changed within 30 days of recording them; others' by Assistant Managers and above.
function useCanChange() {
  const { caps, meEmail, today } = useWF();
  const cutoff = Date.parse(addDays(today, -EDIT_DAYS));
  return (e: TimeEntry) => caps.logTimeForOthers || (e.person === meEmail && e.createdAt >= cutoff);
}

export function MatterSelect({
  value,
  onChange,
  label = 'Mandate',
}: {
  value: string;
  onChange: (id: string) => void;
  label?: string;
}) {
  const { clients, matters } = useWF();
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose a mandate</option>
        {clients.map((c) => {
          const own = matters.filter((m) => m.clientId === c.id && (m.status !== 'closed' || m.id === value));
          if (!own.length) return null;
          return (
            <optgroup key={c.id} label={c.name}>
              {own.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
    </Field>
  );
}

export function TimeForm({
  matterId: fixedMatter,
  entry,
  onSaved,
  onCancel,
}: {
  matterId?: string;
  entry?: TimeEntry;
  onSaved: (e: TimeEntry) => void;
  onCancel?: () => void;
}) {
  const { caps, meEmail, today, run, notify } = useWF();
  const [person, setPerson] = useState<PersonKey | null>(entry?.person ?? meEmail);
  const [date, setDate] = useState<string | null>(entry?.date ?? today);
  const [matterId, setMatterId] = useState(entry?.matterId ?? fixedMatter ?? '');
  const [hours, setHours] = useState(entry ? String(entry.minutes / 60) : '');
  const [description, setDescription] = useState(entry?.description ?? '');
  const [billable, setBillable] = useState(entry?.billable ?? true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const h = Number(hours);
    if (!matterId) return setError('Choose a mandate.');
    if (!date) return setError('Choose the date.');
    if (!(h > 0) || h > 24 || Math.round(h * 4) !== h * 4)
      return setError('Enter hours between 0.25 and 24, in steps of 0.25.');
    if (!person) return setError('Choose the person.');
    const input = {
      matterId,
      person,
      date,
      minutes: Math.round(h * 60),
      description: description.trim(),
      billable,
    };
    setBusy(true);
    const saved = entry
      ? await run('time.update', { id: entry.id, entry: input }, { onError: setError })
      : await run('time.create', { entry: input }, { onError: setError });
    setBusy(false);
    if (saved) {
      notify(entry ? 'Time entry updated' : 'Time logged');
      if (!entry) {
        setHours('');
        setDescription('');
      }
      onSaved(saved);
    }
  };

  return (
    <form onSubmit={submit} className="wf-time-form" aria-label={entry ? 'Edit time entry' : 'Log time'}>
      <div className="wf-grid two">
        {caps.logTimeForOthers ? (
          <PersonPicker label="Person" value={person} onChange={setPerson} allowNone={false} />
        ) : (
          <div className="wf-field">
            <span>Person</span>
            <PersonBadge person={meEmail} showName />
          </div>
        )}
        <DateInput label="Date" value={date} onChange={setDate} max={today} required />
        {!fixedMatter && <MatterSelect value={matterId} onChange={setMatterId} />}
        <Field label="Hours" hint="In steps of a quarter hour">
          <input
            type="number"
            inputMode="decimal"
            min={0.25}
            max={24}
            step={0.25}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Description">
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          placeholder="For example, reviewed the draft SPA tax indemnity"
        />
      </Field>
      <label className="wf-check">
        <input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} />
        <span>Billable</span>
      </label>
      {error && (
        <p className="wf-error" role="alert">
          {error}
        </p>
      )}
      <div className="wf-form-actions">
        {onCancel && (
          <button type="button" className="button secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="button primary" disabled={busy}>
          {entry ? 'Save entry' : 'Log time'}
        </button>
      </div>
    </form>
  );
}

export function EntryList({
  entries,
  showMatter,
  showPerson,
  onChanged,
}: {
  entries: TimeEntry[];
  showMatter?: boolean;
  showPerson?: boolean;
  onChanged: () => void;
}) {
  const { run, notify } = useWF();
  const label = useMatterLabel();
  const canChange = useCanChange();
  const [editing, setEditing] = useState<string | null>(null);
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const total = entries.reduce((s, e) => s + e.minutes, 0);
  const billable = entries.filter((e) => e.billable).reduce((s, e) => s + e.minutes, 0);
  if (!entries.length) return <p className="wf-empty-line">No time recorded in this period.</p>;
  return (
    <>
      <p className="wf-total">
        Total {formatHours(total)}, of which billable {formatHours(billable)}
      </p>
      <TableWrap label="Time entries">
        <table className="wf-table">
          <thead>
            <tr>
              <th scope="col">Date</th>
              {showPerson && <th scope="col">Person</th>}
              {showMatter && <th scope="col">Mandate</th>}
              <th scope="col">Description</th>
              <th scope="col" className="num">
                Hours
              </th>
              <th scope="col">Billable</th>
              <th scope="col">
                <span className="wf-sr">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((e) =>
              editing === e.id ? (
                <tr key={e.id}>
                  <td colSpan={7}>
                    <TimeForm
                      entry={e}
                      onCancel={() => setEditing(null)}
                      onSaved={() => {
                        setEditing(null);
                        onChanged();
                      }}
                    />
                  </td>
                </tr>
              ) : (
                <tr key={e.id}>
                  <td className="nowrap">{formatDate(e.date)}</td>
                  {showPerson && (
                    <td>
                      <PersonBadge person={e.person} showName />
                    </td>
                  )}
                  {showMatter && <td>{label(e.matterId)}</td>}
                  <td>{e.description || <span className="wf-caption">No description</span>}</td>
                  <td className="num">{formatHours(e.minutes)}</td>
                  <td>{e.billable ? 'Yes' : 'No'}</td>
                  <td className="actions">
                    {canChange(e) && (
                      <>
                        <button
                          type="button"
                          className="wf-icon-btn"
                          aria-label="Edit entry"
                          onClick={() => setEditing(e.id)}
                        >
                          <Pencil size={15} />
                        </button>
                        <ConfirmButton
                          className="wf-icon-btn"
                          ariaLabel="Delete entry"
                          question="Delete this entry?"
                          onConfirm={async () => {
                            if (await run('time.delete', { id: e.id })) {
                              notify('Time entry deleted');
                              onChanged();
                            }
                          }}
                        >
                          <Trash2 size={15} />
                        </ConfirmButton>
                      </>
                    )}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </TableWrap>
    </>
  );
}

const RANGES = [
  { id: '30', label: 'Last 30 days' },
  { id: '90', label: 'Last 90 days' },
  { id: '365', label: 'Last 12 months' },
  { id: '730', label: 'Last 2 years' },
];

export function MatterTimeTab({ matter }: { matter: Matter }) {
  const { run, caps, meEmail, today } = useWF();
  const [range, setRange] = useState('90');
  const from = addDays(today, -Number(range));
  const to = today;
  const list = useRemote(`time:${matter.id}:${from}`, () =>
    run('time.list', {
      from,
      to,
      matterId: matter.id,
      ...(caps.logTimeForOthers ? {} : { person: meEmail }),
    }),
  );
  return (
    <div className="wf-split">
      <section className="card wf-section" aria-labelledby="wf-mt-h">
        <h2 id="wf-mt-h">Log time on this mandate</h2>
        <TimeForm matterId={matter.id} onSaved={list.reload} />
      </section>
      <section className="card wf-section" aria-labelledby="wf-mtl-h">
        <div className="wf-row wf-between wf-wrap">
          <h2 id="wf-mtl-h">{caps.logTimeForOthers ? 'Time recorded' : 'Your time on this mandate'}</h2>
          <label className="wf-inline-field">
            <span>Period</span>
            <select value={range} onChange={(e) => setRange(e.target.value)}>
              {RANGES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {list.loading && !list.data ? (
          <p className="wf-loading">Loading time entries</p>
        ) : (
          <EntryList entries={list.data ?? []} showPerson={caps.logTimeForOthers} onChanged={list.reload} />
        )}
      </section>
    </div>
  );
}

export function TimePage() {
  const { run, caps, meEmail, today, matters } = useWF();
  const [viewing, setViewing] = useState<PersonKey | null>(meEmail);
  const person = viewing || meEmail;
  const from = addDays(today, -30);
  const list = useRemote(`time:person:${person}:${from}`, () =>
    run('time.list', { from, to: today, person }),
  );
  const entries = list.data ?? [];
  const wStart = weekStart(today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(wStart, i));
  const perDay = days.map((d) => entries.filter((e) => e.date === d).reduce((s, e) => s + e.minutes, 0));

  if (!matters.length)
    return (
      <div className="wf-stack">
        <Empty title="No mandates to record time against">
          Time is recorded against a mandate. Mandates you are staffed on appear here once they are added.
        </Empty>
        <ExportPanel />
      </div>
    );

  return (
    <div className="wf-stack">
      <div className="wf-split">
        <section className="card wf-section" aria-labelledby="wf-log-h">
          <h2 id="wf-log-h">Log time</h2>
          <TimeForm onSaved={list.reload} />
        </section>
        <section className="card wf-section" aria-labelledby="wf-week-h">
          <h2 id="wf-week-h">This week</h2>
          <p className="wf-caption">
            <PersonBadge person={person} showName />
          </p>
          <div className="wf-week">
            {days.map((d, i) => (
              <div key={d} className={d === today ? 'today' : ''}>
                <span>{formatWeekday(d)}</span>
                <strong>{perDay[i] ? formatHours(perDay[i]) : '-'}</strong>
              </div>
            ))}
          </div>
          <p className="wf-total">Week total {formatHours(perDay.reduce((s, m) => s + m, 0))}</p>
        </section>
      </div>
      <section className="card wf-section" aria-labelledby="wf-recent-h">
        <div className="wf-row wf-between wf-wrap">
          <h2 id="wf-recent-h">Entries in the last 30 days</h2>
          {caps.logTimeForOthers && (
            <PersonPicker label="Show entries of" value={viewing} onChange={setViewing} allowNone={false} />
          )}
        </div>
        {list.loading && !list.data ? (
          <p className="wf-loading">Loading time entries</p>
        ) : (
          <EntryList entries={entries} showMatter onChanged={list.reload} />
        )}
      </section>
      <ExportPanel />
    </div>
  );
}

function ExportPanel() {
  const { run, caps, today, clients, notify } = useWF();
  const [from, setFrom] = useState<string | null>(today.slice(0, 8) + '01');
  const [to, setTo] = useState<string | null>(today);
  const [group, setGroup] = useState<'raw' | 'client' | 'matter' | 'person'>('raw');
  const [clientId, setClientId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!from || !to || from > to) return setError('Choose a start date on or before the end date.');
    setBusy(true);
    const r = await run(
      'time.export',
      { from, to, group, ...(clientId ? { clientId } : {}) },
      { onError: setError },
    );
    setBusy(false);
    if (r) {
      download(r.filename, r.csv);
      notify('Timesheet exported');
    }
  };
  return (
    <section className="card wf-section" aria-labelledby="wf-export-h">
      <h2 id="wf-export-h">Export timesheets</h2>
      <p className="wf-caption">
        {caps.exportFirmTime
          ? 'Exports cover the whole firm for the chosen period, as a CSV file that opens in Excel.'
          : 'Exports cover the time entries you are allowed to see, as a CSV file that opens in Excel.'}
      </p>
      <form className="wf-filters" onSubmit={submit}>
        <DateInput label="From" value={from} onChange={setFrom} required />
        <DateInput label="To" value={to} onChange={setTo} required />
        <Field label="Group by">
          <select value={group} onChange={(e) => setGroup(e.target.value as typeof group)}>
            <option value="raw">Every entry</option>
            <option value="client">Client</option>
            <option value="matter">Mandate</option>
            <option value="person">Person</option>
          </select>
        </Field>
        <Field label="Client">
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="wf-quick-submit">
          <button type="submit" className="button primary" disabled={busy}>
            <Download size={15} /> Download CSV
          </button>
        </div>
      </form>
      {error && (
        <p className="wf-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
