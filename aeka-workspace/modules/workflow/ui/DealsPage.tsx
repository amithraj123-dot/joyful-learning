'use client';
// Deal tracker: target documents and the counterparty ledger with residency-driven suggestions. Edits stay
// local (and survive switching pages) until "Save tracker", which saves with a revision check.
import { useState } from 'react';
import { ArrowUpRight, Handshake, Plus, Sparkles, Trash2 } from 'lucide-react';
import type { DealInput } from '../shared/contract';
import {
  COUNTERPARTY_DOC_DEFAULTS,
  DOC_STATUSES,
  NON_RESIDENT_FEMA_DOCS,
  NON_RESIDENT_TAX_DOCS,
  RESIDENCY,
  TARGET_DOC_DEFAULTS,
  docCounts,
  type Counterparty,
  type DealDoc,
  type DealTracker,
  type DocStatus,
  type Residency,
} from '../shared/types';
import { Dirty, Empty, TableWrap } from './components/Bits';
import { ConfirmButton } from './components/ConfirmButton';
import { Field } from './components/Inputs';
import { uid, type Nav } from './lib';
import { CONFLICT_MESSAGE, dealDirty, dealInput, useRemote, useWF } from './store';

const newDoc = (name: string): DealDoc => ({ id: uid(), name, status: 'Not Started', notes: '' });
const has = (docs: DealDoc[], name: string) =>
  docs.some((d) => d.name.trim().toLowerCase() === name.trim().toLowerCase());

function useDeal(matterId: string) {
  const { run, dealDrafts, setDealDrafts } = useWF();
  const remote = useRemote('deal:' + matterId, () => run('deal.get', { matterId }));
  const stored = dealDrafts[matterId];
  const base = stored?.base ?? remote.data;
  const draft = stored?.draft ?? (base ? dealInput(base) : undefined);
  const change = (fn: (d: DealInput) => DealInput) => {
    if (!base || !draft) return;
    setDealDrafts((all) => ({
      ...all,
      [matterId]: { base: all[matterId]?.base ?? base, draft: fn(all[matterId]?.draft ?? draft) },
    }));
  };
  const discard = () => {
    setDealDrafts((all) => {
      const next = { ...all };
      delete next[matterId];
      return next;
    });
    remote.reload();
  };
  const settle = (saved: DealTracker) =>
    setDealDrafts((all) => ({ ...all, [matterId]: { base: saved, draft: dealInput(saved) } }));
  return { base, draft, change, discard, settle, loading: remote.loading, dirty: dealDirty(stored) };
}

export function DealSummary({ matterId }: { matterId: string }) {
  const { draft, dirty } = useDeal(matterId);
  if (!draft) return <p className="wf-loading">Loading the deal tracker</p>;
  const c = docCounts(draft);
  return (
    <div className="wf-kpis">
      <Kpi label="Deal value" value={draft.dealValue || 'Not recorded'} />
      <Kpi label="Representing" value={draft.representing} />
      <Kpi label="Target company" value={draft.targetCompany || 'Not recorded'} />
      <Kpi label="Executed documents" value={`${c.executed} of ${c.total} (${c.percent}%)`} />
      {dirty && <p className="wf-caption">There are unsaved changes in the deal tracker.</p>}
    </div>
  );
}

function Kpi({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div className="wf-kpi">
      <span>{label}</span>
      {children ?? <strong>{value}</strong>}
    </div>
  );
}

export function DealsPage({ navigate }: { navigate: Nav }) {
  const { matters, clientById, focusDeal, setFocusDeal, setFocusMatter, dealDrafts } = useWF();
  const deals = matters
    .filter((m) => m.isDeal)
    .sort(
      (a, b) =>
        Number(a.status === 'closed') - Number(b.status === 'closed') || a.title.localeCompare(b.title),
    );
  if (!deals.length)
    return (
      <Empty icon={Handshake} title="No deal mandates">
        Mark a mandate as a deal mandate (when adding or editing it) to track its documents here.
      </Empty>
    );
  const selected = deals.find((d) => d.id === focusDeal) ?? deals[0];
  return (
    <div className="wf-stack">
      <div className="wf-toolbar">
        <Field label="Deal">
          <select value={selected.id} onChange={(e) => setFocusDeal(e.target.value)}>
            {deals.map((d) => (
              <option key={d.id} value={d.id}>
                {clientById.get(d.clientId)?.name}: {d.title}
                {d.status === 'closed' ? ' (closed)' : ''}
                {dealDirty(dealDrafts[d.id]) ? ' (unsaved changes)' : ''}
              </option>
            ))}
          </select>
        </Field>
        <button
          type="button"
          className="text-link"
          onClick={() => {
            setFocusMatter(selected.id);
            navigate('workflow/matters');
          }}
        >
          Open the mandate <ArrowUpRight size={14} />
        </button>
      </div>
      <DealEditor key={selected.id} matterId={selected.id} />
    </div>
  );
}

function DealEditor({ matterId }: { matterId: string }) {
  const { run, notify, caps, meEmail, matterById } = useWF();
  const { base, draft, change, discard, settle, dirty } = useDeal(matterId);
  // Saving is open to the mandate team and Assistant Managers and above.
  const canEdit = caps.manageMatters || !!matterById.get(matterId)?.team.includes(meEmail);
  const [party, setParty] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState('');
  if (!base || !draft) return <p className="wf-loading">Loading the deal tracker</p>;
  const c = docCounts(draft);
  const set = <K extends keyof DealInput>(k: K, v: DealInput[K]) => change((d) => ({ ...d, [k]: v }));
  const setParties = (fn: (p: Counterparty[]) => Counterparty[]) =>
    change((d) => ({ ...d, counterparties: fn(d.counterparties) }));
  const setPartyField = (id: string, patch: Partial<Counterparty>) =>
    setParties((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const addParty = () => {
    const name = party.trim();
    if (!name) return;
    if (draft.counterparties.some((p) => p.name.trim().toLowerCase() === name.toLowerCase()))
      return setError(`${name} is already listed.`);
    setError('');
    setParties((ps) => [
      ...ps,
      {
        id: uid(),
        name,
        incomeTax: 'Resident',
        fema: 'Resident',
        docs: COUNTERPARTY_DOC_DEFAULTS.map(newDoc),
      },
    ]);
    setParty('');
  };

  const addSuggested = () => {
    let added = 0;
    const targetDocs = [...draft.targetDocs];
    for (const n of TARGET_DOC_DEFAULTS)
      if (!has(targetDocs, n)) {
        targetDocs.push(newDoc(n));
        added++;
      }
    const counterparties = draft.counterparties.map((p) => {
      const docs = [...p.docs];
      const want = [
        ...(p.docs.length ? [] : COUNTERPARTY_DOC_DEFAULTS),
        ...(p.incomeTax === 'Non-Resident' ? NON_RESIDENT_TAX_DOCS : []),
        ...(p.fema === 'Non-Resident' ? NON_RESIDENT_FEMA_DOCS : []),
      ];
      for (const n of want)
        if (!has(docs, n)) {
          docs.push(newDoc(n));
          added++;
        }
      return { ...p, docs };
    });
    if (added) change(() => ({ ...draft, targetDocs, counterparties }));
    notify(
      added
        ? `Added ${added} suggested documents. Save the tracker to keep them.`
        : 'All suggested documents are already listed.',
    );
  };

  const save = async () => {
    setBusy(true);
    setError('');
    const saved = await run(
      'deal.save',
      { matterId, deal: draft, baseRevision: base.revision },
      {
        onError: (m) => {
          if (m === CONFLICT_MESSAGE) setConflict(true);
          setError(m);
        },
      },
    );
    setBusy(false);
    if (saved) {
      settle(saved);
      setConflict(false);
      notify('Deal tracker saved');
    }
  };

  const side = draft.representing === 'Buy Side' ? 'Sellers' : 'Buyers';
  return (
    <fieldset className="wf-plain wf-stack" disabled={!canEdit}>
      <legend className="wf-sr">Deal tracker</legend>
      {!canEdit && (
        <p className="wf-note">
          You can read this tracker. Changes are made by the mandate team and Assistant Managers and above.
        </p>
      )}
      <section className="wf-panel" aria-label="Deal overview">
        <div className="wf-kpis edit">
          <Field label="Deal value">
            <input
              value={draft.dealValue}
              onChange={(e) => set('dealValue', e.target.value)}
              placeholder="For example, INR 45 crore"
            />
          </Field>
          <Field label="Representing">
            <select
              value={draft.representing}
              onChange={(e) => set('representing', e.target.value as DealInput['representing'])}
            >
              <option>Buy Side</option>
              <option>Sell Side</option>
            </select>
          </Field>
          <Field label="Target company">
            <input value={draft.targetCompany} onChange={(e) => set('targetCompany', e.target.value)} />
          </Field>
          <Kpi label={side} value={String(draft.counterparties.length)} />
          <Kpi label="Signing progress">
            <strong>{c.percent}%</strong>
            <span
              className="wf-progress"
              role="progressbar"
              aria-valuenow={c.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Documents executed"
            >
              <span style={{ width: c.percent + '%' }} />
            </span>
            <small>
              {c.executed} of {c.total} applicable documents executed
            </small>
          </Kpi>
        </div>
      </section>

      <section className="card wf-section" aria-labelledby="wf-target-h">
        <h2 id="wf-target-h">Target company documents</h2>
        <DocTable
          docs={draft.targetDocs}
          onChange={(docs) => set('targetDocs', docs)}
          label="Target company documents"
        />
      </section>

      <section className="card wf-section" aria-labelledby="wf-cp-h">
        <div className="wf-row wf-between wf-wrap">
          <h2 id="wf-cp-h">
            {side} ledger ({draft.counterparties.length})
          </h2>
          <button type="button" className="button secondary" onClick={addSuggested}>
            <Sparkles size={15} /> Add suggested documents
          </button>
        </div>
        <p className="wf-caption">
          New parties start with {COUNTERPARTY_DOC_DEFAULTS.join(', ')}. For a non-resident party, the
          suggested documents add {NON_RESIDENT_TAX_DOCS.join(' and ')} for income tax, and{' '}
          {NON_RESIDENT_FEMA_DOCS.join(' and ')} for FEMA.
        </p>
        <div className="wf-inline-add">
          <input
            className="wf-input grow"
            value={party}
            aria-label={`New ${side === 'Sellers' ? 'seller' : 'buyer'} name`}
            placeholder={`Add a ${side === 'Sellers' ? 'seller' : 'buyer'}`}
            onChange={(e) => setParty(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addParty();
              }
            }}
          />
          <button type="button" className="button primary" disabled={!party.trim()} onClick={addParty}>
            <Plus size={15} /> Add party
          </button>
        </div>
        {draft.counterparties.map((p) => {
          const missing = [
            ...(p.incomeTax === 'Non-Resident' ? NON_RESIDENT_TAX_DOCS : []),
            ...(p.fema === 'Non-Resident' ? NON_RESIDENT_FEMA_DOCS : []),
          ].filter((n) => !has(p.docs, n));
          return (
            <article key={p.id} className="wf-party" aria-label={p.name}>
              <div className="wf-party-head">
                <Field label="Party name">
                  <input value={p.name} onChange={(e) => setPartyField(p.id, { name: e.target.value })} />
                </Field>
                <Field label="Income tax residency">
                  <select
                    value={p.incomeTax}
                    onChange={(e) => setPartyField(p.id, { incomeTax: e.target.value as Residency })}
                  >
                    {RESIDENCY.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </Field>
                <Field label="FEMA residency">
                  <select
                    value={p.fema}
                    onChange={(e) => setPartyField(p.id, { fema: e.target.value as Residency })}
                  >
                    {RESIDENCY.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </Field>
                <ConfirmButton
                  question={`Remove ${p.name} and its documents?`}
                  confirmLabel="Remove"
                  onConfirm={() => setParties((ps) => ps.filter((x) => x.id !== p.id))}
                >
                  <Trash2 size={15} /> Remove
                </ConfirmButton>
              </div>
              {missing.length > 0 && (
                <p className="wf-note">Suggested for a non-resident: {missing.join(', ')}.</p>
              )}
              <DocTable
                docs={p.docs}
                onChange={(docs) => setPartyField(p.id, { docs })}
                label={`Documents for ${p.name}`}
              />
            </article>
          );
        })}
      </section>

      {canEdit && (
        <div className="wf-savebar" role="region" aria-label="Save the deal tracker">
          <Dirty dirty={dirty} />
          {conflict && (
            <span className="wf-error">
              The tracker was saved by someone else. Discard your changes to load the latest version.
            </span>
          )}
          {error && !conflict && (
            <span className="wf-error" role="alert">
              {error}
            </span>
          )}
          <span className="wf-row">
            {dirty && (
              <ConfirmButton
                question="Discard your changes?"
                confirmLabel="Discard"
                className="button ghost"
                onConfirm={() => {
                  discard();
                  setConflict(false);
                  setError('');
                }}
              >
                Discard changes
              </ConfirmButton>
            )}
            <button
              type="button"
              className="button primary"
              disabled={!dirty || busy}
              onClick={() => void save()}
            >
              {busy ? 'Saving' : 'Save tracker'}
            </button>
          </span>
        </div>
      )}
    </fieldset>
  );
}

function DocTable({
  docs,
  onChange,
  label,
}: {
  docs: DealDoc[];
  onChange: (d: DealDoc[]) => void;
  label: string;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const setDoc = (id: string, patch: Partial<DealDoc>) =>
    onChange(docs.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const add = () => {
    const n = name.trim();
    if (!n) return;
    if (has(docs, n)) return setError(`${n} is already listed.`);
    onChange([...docs, newDoc(n)]);
    setName('');
    setError('');
  };
  return (
    <>
      <TableWrap label={label}>
        <table className="wf-table">
          <thead>
            <tr>
              <th scope="col">Document</th>
              <th scope="col">Status</th>
              <th scope="col">Notes</th>
              <th scope="col">
                <span className="wf-sr">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id} className={d.status === 'Not Applicable' ? 'faded' : ''}>
                <td>
                  <input
                    className="wf-cell-input"
                    aria-label="Document name"
                    value={d.name}
                    onChange={(e) => setDoc(d.id, { name: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    className="wf-cell-input"
                    aria-label={`Status of ${d.name}`}
                    value={d.status}
                    onChange={(e) => setDoc(d.id, { status: e.target.value as DocStatus })}
                  >
                    {DOC_STATUSES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    className="wf-cell-input"
                    aria-label={`Notes on ${d.name}`}
                    value={d.notes}
                    onChange={(e) => setDoc(d.id, { notes: e.target.value })}
                  />
                </td>
                <td className="actions">
                  <ConfirmButton
                    className="wf-icon-btn"
                    ariaLabel={`Remove ${d.name}`}
                    question="Remove?"
                    confirmLabel="Remove"
                    onConfirm={() => onChange(docs.filter((x) => x.id !== d.id))}
                  >
                    <Trash2 size={15} />
                  </ConfirmButton>
                </td>
              </tr>
            ))}
            {!docs.length && (
              <tr>
                <td colSpan={4} className="wf-caption">
                  No documents yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableWrap>
      <div className="wf-inline-add">
        <input
          className="wf-input grow"
          value={name}
          aria-label={`Add a document to ${label}`}
          placeholder="Add a document"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="button secondary" disabled={!name.trim()} onClick={add}>
          <Plus size={15} /> Add document
        </button>
      </div>
      {error && <p className="wf-error">{error}</p>}
    </>
  );
}
