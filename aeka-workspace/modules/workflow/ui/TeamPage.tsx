'use client';
// Team and access: firm members with designation and administrator rights (administrators edit), and
// the one-time import from the earlier Google Sheet app.
import { useState } from 'react';
import { Pencil, Plus, Upload, UserX } from 'lucide-react';
import type { LegacyPreview } from '../shared/contract';
import { StatusPill, TableWrap, Toggle } from './components/Bits';
import { ConfirmButton } from './components/ConfirmButton';
import { Field } from './components/Inputs';
import { Modal } from './components/Modal';
import { DESIGNATIONS, rank, type Designation, type Member } from './lib';
import { useWF } from './store';

export function TeamPage() {
  const { members, isAdmin, caps, meEmail, runCore, reloadMembers, notify } = useWF();
  const [editing, setEditing] = useState<Member | 'new' | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const list = members
    .filter((m) => showInactive || m.active)
    .sort((a, b) => Number(b.active) - Number(a.active) || rank(b) - rank(a) || a.name.localeCompare(b.name));
  return (
    <div className="wf-stack">
      <section className="card wf-section" aria-labelledby="wf-members-h">
        <div className="wf-row wf-between wf-wrap">
          <h2 id="wf-members-h">Members ({members.filter((m) => m.active).length} active)</h2>
          <div className="wf-row wf-wrap">
            <Toggle pressed={showInactive} onChange={setShowInactive}>
              Show inactive members
            </Toggle>
            {isAdmin && (
              <button type="button" className="button primary" onClick={() => setEditing('new')}>
                <Plus size={15} /> Add member
              </button>
            )}
          </div>
        </div>
        <p className="wf-caption">
          People sign in with their firm email. Designation decides what they can do: Assistant Managers and
          above manage mandates, deadlines, billing and reviews; administrators manage membership.
          {!isAdmin && ' Only administrators can change membership.'}
        </p>
        <TableWrap label="Members">
          <table className="wf-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Initials</th>
                <th scope="col">Email</th>
                <th scope="col">Designation</th>
                <th scope="col">Access</th>
                {isAdmin && (
                  <th scope="col">
                    <span className="wf-sr">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {list.map((m) => (
                <tr key={m.email} className={m.active ? '' : 'faded'}>
                  <td>
                    <strong>{m.name}</strong>
                    {m.email === meEmail && <span className="wf-caption"> (you)</span>}
                  </td>
                  <td>
                    <span className="wf-badge">{m.initials}</span>
                  </td>
                  <td className="wf-break">{m.email}</td>
                  <td>{m.designation}</td>
                  <td>
                    <span className="wf-row wf-wrap">
                      {m.isAdmin && <StatusPill value="admin" label="Administrator" tone="red" />}
                      {!m.active && <StatusPill value="inactive" label="Inactive" tone="grey" />}
                      {m.active && !m.isAdmin && <span className="wf-caption">Member</span>}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="actions">
                      <button
                        type="button"
                        className="wf-icon-btn"
                        aria-label={`Edit ${m.name}`}
                        onClick={() => setEditing(m)}
                      >
                        <Pencil size={15} />
                      </button>
                      {m.active && m.email !== meEmail && (
                        <ConfirmButton
                          className="wf-icon-btn"
                          ariaLabel={`Deactivate ${m.name}`}
                          question={`Deactivate ${m.name}?`}
                          confirmLabel="Deactivate"
                          onConfirm={async () => {
                            if (await runCore('members.deactivate', { email: m.email })) {
                              notify(`${m.name} deactivated`);
                              await reloadMembers();
                            }
                          }}
                        >
                          <UserX size={15} />
                        </ConfirmButton>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </section>
      {caps.importData && <ImportPanel />}
      {editing && (
        <MemberForm member={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function MemberForm({ member, onClose }: { member?: Member; onClose: () => void }) {
  const { runCore, reloadMembers, notify, meEmail } = useWF();
  const [email, setEmail] = useState(member?.email ?? '');
  const [name, setName] = useState(member?.name ?? '');
  const [initials, setInitials] = useState(member?.initials ?? '');
  const [designation, setDesignation] = useState<Designation>(member?.designation ?? 'Associate');
  const [isAdmin, setIsAdmin] = useState(member?.isAdmin ?? false);
  const [active, setActive] = useState(member?.active ?? true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    const saved = await runCore<Member>(
      'members.save',
      { member: { email, name, initials, designation, isAdmin, active } },
      { onError: setError },
    );
    setBusy(false);
    if (saved) {
      notify(member ? 'Member updated' : 'Member added');
      await reloadMembers();
      onClose();
    }
  };
  const self = member?.email === meEmail;
  return (
    <Modal title={member ? 'Edit member' : 'Add a member'} onClose={onClose}>
      <form onSubmit={submit}>
        <Field
          label="Firm email"
          hint={
            member
              ? 'The email identifies the member and cannot be changed.'
              : 'The address they sign in with.'
          }
        >
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={!!member}
            required
            data-autofocus={!member || undefined}
          />
        </Field>
        <div className="wf-grid two">
          <Field label="Full name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={120}
              data-autofocus={member ? true : undefined}
            />
          </Field>
          <Field label="Initials" hint="Up to 4 letters; left blank, they are taken from the name.">
            <input
              value={initials}
              onChange={(e) => setInitials(e.target.value.toUpperCase())}
              maxLength={4}
            />
          </Field>
          <Field label="Designation">
            <select value={designation} onChange={(e) => setDesignation(e.target.value as Designation)}>
              {DESIGNATIONS.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="wf-toggles">
          <Toggle pressed={isAdmin} onChange={setIsAdmin} disabled={self && isAdmin}>
            Administrator (manages membership and imports)
          </Toggle>
          <Toggle pressed={active} onChange={setActive} disabled={self}>
            Active
          </Toggle>
        </div>
        {self && (
          <p className="wf-caption">
            You cannot remove your own administrator rights or deactivate yourself.
          </p>
        )}
        {error && (
          <p className="wf-error" role="alert">
            {error}
          </p>
        )}
        <div className="wf-form-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={busy}>
            {member ? 'Save member' : 'Add member'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ImportPanel() {
  const { run, members, reload, notify } = useWF();
  const [source, setSource] = useState<'url' | 'json'>('url');
  const [url, setUrl] = useState('');
  const [json, setJson] = useState('');
  const [preview, setPreview] = useState<LegacyPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<LegacyPreview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const payload = () => (source === 'url' ? { url: url.trim() } : { json });

  const doPreview = async () => {
    setError('');
    setResult(null);
    if (source === 'url' && !/^https:\/\/script\.google(usercontent)?\.com\//.test(url.trim()))
      return setError('Paste the Apps Script web app address, which starts with https://script.google.com/.');
    if (source === 'json' && !json.trim()) return setError('Paste the JSON or choose a file.');
    setBusy(true);
    const p = await run('import.preview', payload(), { onError: setError });
    setBusy(false);
    if (p) {
      setPreview(p);
      setMapping(Object.fromEntries(p.people.map((x) => [x.initials, x.email ?? ''])));
    }
  };
  const doRun = async () => {
    if (!preview) return;
    setError('');
    setBusy(true);
    const r = await run(
      'import.run',
      {
        ...payload(),
        people: preview.people.map((p) => ({
          initials: p.initials,
          email: mapping[p.initials]?.trim() || null,
        })),
      },
      { onError: setError },
    );
    setBusy(false);
    if (r) {
      setResult(r);
      setPreview(null);
      notify('Import complete');
      await reload();
    }
  };

  const counts = (p: LegacyPreview) =>
    [
      ['Clients', p.clients],
      ['Mandates', p.matters],
      ['Tasks', p.tasks],
      ['Time entries', p.timeEntries],
      ['Deadlines', p.milestones],
      ['Invoices', p.invoices],
      ['Deal trackers', p.dealTrackers],
    ] as const;

  return (
    <section className="card wf-section" aria-labelledby="wf-import-h">
      <h2 id="wf-import-h">Import from the earlier Google Sheet</h2>
      <p className="wf-caption">
        Bring clients, mandates, tasks, time, deadlines, invoices and deal trackers across from the earlier
        team workflow sheet; once the import has been checked, the earlier sheet can be retired.
      </p>
      <div className="wf-chips" role="group" aria-label="Import source">
        <button
          type="button"
          className={'wf-chip' + (source === 'url' ? ' active' : '')}
          aria-pressed={source === 'url'}
          onClick={() => setSource('url')}
        >
          Apps Script address
        </button>
        <button
          type="button"
          className={'wf-chip' + (source === 'json' ? ' active' : '')}
          aria-pressed={source === 'json'}
          onClick={() => setSource('json')}
        >
          JSON file or text
        </button>
      </div>
      {source === 'url' ? (
        <Field
          label="Apps Script web app address"
          hint="The address the earlier app was set up with. The server reads the sheet once."
        >
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://script.google.com/macros/s/.../exec"
            inputMode="url"
          />
        </Field>
      ) : (
        <>
          <Field label="Exported JSON">
            <textarea
              rows={5}
              value={json}
              onChange={(e) => setJson(e.target.value)}
              placeholder='{"clients": [...], "teamMembers": [...]}'
            />
          </Field>
          <label className="button secondary wf-file">
            <Upload size={15} /> Choose a JSON file
            <input
              type="file"
              accept="application/json,.json,.txt"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setJson(await f.text());
              }}
            />
          </label>
        </>
      )}
      <div className="wf-form-actions">
        <button type="button" className="button primary" disabled={busy} onClick={() => void doPreview()}>
          Preview the import
        </button>
      </div>
      {error && (
        <p className="wf-error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <div className="wf-stack small">
          <h3 className="wf-h3">What will be imported</h3>
          <dl className="wf-counts">
            {counts(preview).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {preview.warnings.length > 0 && (
            <ul className="wf-warnings">
              {preview.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          <h3 className="wf-h3">People in the sheet</h3>
          <p className="wf-caption">
            Match each set of initials to a member&apos;s email. Leave it blank to keep the initials as an
            unmapped person, shown in grey, who can be matched later.
          </p>
          <datalist id="wf-member-emails">
            {members
              .filter((m) => m.active)
              .map((m) => (
                <option key={m.email} value={m.email}>
                  {m.name}
                </option>
              ))}
          </datalist>
          <TableWrap label="People mapping">
            <table className="wf-table">
              <thead>
                <tr>
                  <th scope="col">Initials</th>
                  <th scope="col">Name in the sheet</th>
                  <th scope="col">Designation</th>
                  <th scope="col">Member email</th>
                </tr>
              </thead>
              <tbody>
                {preview.people.map((p) => (
                  <tr key={p.initials}>
                    <td>
                      <span className="wf-badge legacy">{p.initials}</span>
                    </td>
                    <td>{p.name || '-'}</td>
                    <td>{p.designation || '-'}</td>
                    <td>
                      <input
                        className="wf-cell-input"
                        type="email"
                        list="wf-member-emails"
                        aria-label={`Email for ${p.initials}`}
                        value={mapping[p.initials] ?? ''}
                        onChange={(e) => setMapping((m) => ({ ...m, [p.initials]: e.target.value }))}
                        placeholder="Keep as initials"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <div className="wf-form-actions">
            <button type="button" className="button secondary" onClick={() => setPreview(null)}>
              Cancel
            </button>
            <button type="button" className="button primary" disabled={busy} onClick={() => void doRun()}>
              Run the import
            </button>
          </div>
        </div>
      )}
      {result && (
        <div className="wf-panel" role="status">
          <h3 className="wf-h3">Import complete</h3>
          <dl className="wf-counts">
            {counts(result).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {result.warnings.length > 0 && (
            <ul className="wf-warnings">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
