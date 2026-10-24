'use client';
// Engagements and billing (Assistant Managers and above): engagement letter and invoice status, fee, the
// billed amount derived from the invoice log, and amounts outstanding. Each row saves explicitly.
import { useState } from 'react';
import { FileText, ReceiptIndianRupee, Search, Trash2 } from 'lucide-react';
import type { BillingInput } from '../shared/contract';
import {
  EL_STATUSES,
  INVOICE_STATUSES,
  formatINR,
  type ElStatus,
  type InvoiceStatus,
  type Matter,
  type MatterBilling,
} from '../shared/types';
import { Empty, StatusPill, TableWrap } from './components/Bits';
import { ConfirmButton } from './components/ConfirmButton';
import { DateInput, Field, MoneyInput } from './components/Inputs';
import { Modal } from './components/Modal';
import { PersonBadge } from './components/People';
import { formatDate, type Nav } from './lib';
import { useMatterLabel, useRemote, useWF } from './store';

const blank = (matterId: string): MatterBilling => ({
  matterId,
  elStatus: 'Not Started',
  invoiceStatus: 'Not Invoiced',
  feePaise: null,
  billedPaise: 0,
  adminNotes: '',
  revision: 0,
  updatedAt: 0,
});
const outstanding = (b: Pick<MatterBilling, 'feePaise' | 'billedPaise'>) =>
  b.feePaise == null ? null : b.feePaise - b.billedPaise;
const inputOf = (b: MatterBilling): BillingInput => ({
  elStatus: b.elStatus,
  invoiceStatus: b.invoiceStatus,
  feePaise: b.feePaise,
  adminNotes: b.adminNotes,
});

function useBillingDraft(b: MatterBilling) {
  const { run, dispatch, notify } = useWF();
  const [draft, setDraft] = useState<BillingInput>(() => inputOf(b));
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(inputOf(b));
  const set = <K extends keyof BillingInput>(k: K, v: BillingInput[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const save = async () => {
    setBusy(true);
    const saved = await run('billing.update', {
      matterId: b.matterId,
      billing: draft,
      baseRevision: b.revision,
    });
    setBusy(false);
    if (saved) {
      dispatch({ type: 'billing', billing: saved });
      notify('Billing saved');
    }
  };
  return { draft, set, dirty, save, busy };
}

export function BillingPage({ navigate }: { navigate: Nav }) {
  const { caps, matters, billingByMatter, clientById, setFocusMatter } = useWF();
  const [search, setSearch] = useState('');
  const [el, setEl] = useState('all');
  const [inv, setInv] = useState('all');
  const [closed, setClosed] = useState(false);
  const [log, setLog] = useState<string | null>(null);
  const label = useMatterLabel();
  if (!caps.viewBilling)
    return (
      <Empty icon={ReceiptIndianRupee} title="Billing is restricted">
        Engagement letters, fees and invoices are visible to Assistant Managers and above. Ask a manager on
        the mandate if you need billing information.
      </Empty>
    );
  const q = search.trim().toLowerCase();
  const rows = matters
    .filter((m) => closed || m.status !== 'closed')
    .map((m) => ({ m, b: billingByMatter.get(m.id) ?? blank(m.id) }))
    .filter(
      ({ m, b }) =>
        (el === 'all' || b.elStatus === el) &&
        (inv === 'all' || b.invoiceStatus === inv) &&
        (!q || [m.title, m.type, clientById.get(m.clientId)?.name].join(' ').toLowerCase().includes(q)),
    )
    .sort((a, b) => label(a.m.id).localeCompare(label(b.m.id)));
  const fee = rows.reduce((s, r) => s + (r.b.feePaise ?? 0), 0);
  const billed = rows.reduce((s, r) => s + r.b.billedPaise, 0);
  const due = rows.reduce((s, r) => s + Math.max(outstanding(r.b) ?? 0, 0), 0);
  return (
    <div className="wf-stack">
      <div className="stats-row wf-stats three">
        <div>
          <span>Agreed fees</span>
          <strong className="smaller">{formatINR(fee)}</strong>
        </div>
        <div>
          <span>Billed</span>
          <strong className="smaller">{formatINR(billed)}</strong>
        </div>
        <div>
          <span>Outstanding</span>
          <strong className="smaller">{formatINR(due)}</strong>
        </div>
      </div>
      <div className="wf-toolbar">
        <label className="search-box wf-search">
          <Search size={16} aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients or mandates"
            aria-label="Search billing"
          />
        </label>
        <div className="wf-filters">
          <Field label="Engagement letter">
            <select value={el} onChange={(e) => setEl(e.target.value)}>
              <option value="all">All</option>
              {EL_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Invoicing">
            <select value={inv} onChange={(e) => setInv(e.target.value)}>
              <option value="all">All</option>
              {INVOICE_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <label className="wf-check">
            <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} />
            <span>Include closed mandates</span>
          </label>
        </div>
      </div>
      {!caps.editBilling && (
        <p className="wf-note">You can view billing. Changes are made by members with billing rights.</p>
      )}
      {!rows.length ? (
        <p className="wf-empty-line">No mandates match.</p>
      ) : (
        <TableWrap label="Engagements and billing">
          <table className="wf-table wf-billing">
            <thead>
              <tr>
                <th scope="col">Client and mandate</th>
                <th scope="col">Engagement letter</th>
                <th scope="col">Invoicing</th>
                <th scope="col">Fee</th>
                <th scope="col" className="num">
                  Billed
                </th>
                <th scope="col" className="num">
                  Outstanding
                </th>
                <th scope="col">Notes</th>
                <th scope="col">
                  <span className="wf-sr">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ m, b }) => (
                <BillingRow
                  key={m.id + ':' + b.revision}
                  matter={m}
                  billing={b}
                  onLog={() => setLog(m.id)}
                  onOpen={() => {
                    setFocusMatter(m.id);
                    navigate('workflow/matters');
                  }}
                />
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {log && (
        <Modal title="Invoice log" subtitle={label(log)} onClose={() => setLog(null)} wide>
          <InvoiceLog matterId={log} />
        </Modal>
      )}
    </div>
  );
}

function BillingRow({
  matter,
  billing,
  onLog,
  onOpen,
}: {
  matter: Matter;
  billing: MatterBilling;
  onLog: () => void;
  onOpen: () => void;
}) {
  const { caps, clientById } = useWF();
  const { draft, set, dirty, save, busy } = useBillingDraft(billing);
  const out = outstanding({ feePaise: draft.feePaise, billedPaise: billing.billedPaise });
  const ro = !caps.editBilling;
  return (
    <tr className={dirty ? 'dirty' : ''}>
      <td>
        <button type="button" className="wf-link strong" onClick={onOpen}>
          {matter.title}
        </button>
        <div className="wf-caption">
          {clientById.get(matter.clientId)?.name}, {matter.type}
        </div>
      </td>
      <td>
        {ro ? (
          <StatusPill value={draft.elStatus} />
        ) : (
          <select
            className="wf-cell-input"
            aria-label={`Engagement letter for ${matter.title}`}
            value={draft.elStatus}
            onChange={(e) => set('elStatus', e.target.value as ElStatus)}
          >
            {EL_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        )}
      </td>
      <td>
        {ro ? (
          <StatusPill value={draft.invoiceStatus} />
        ) : (
          <select
            className="wf-cell-input"
            aria-label={`Invoicing for ${matter.title}`}
            value={draft.invoiceStatus}
            onChange={(e) => set('invoiceStatus', e.target.value as InvoiceStatus)}
          >
            {INVOICE_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        )}
      </td>
      <td>
        {ro ? (
          formatINR(draft.feePaise)
        ) : (
          <MoneyInput
            hideLabel
            label={`Fee for ${matter.title}`}
            value={draft.feePaise}
            onChange={(v) => set('feePaise', v)}
          />
        )}
      </td>
      <td className="num">{formatINR(billing.billedPaise)}</td>
      <td className={'num' + (out != null && out < 0 ? ' wf-overdue' : '')}>{formatINR(out)}</td>
      <td>
        {ro ? (
          draft.adminNotes
        ) : (
          <textarea
            className="wf-cell-input"
            rows={2}
            aria-label={`Notes for ${matter.title}`}
            value={draft.adminNotes}
            onChange={(e) => set('adminNotes', e.target.value)}
          />
        )}
      </td>
      <td className="actions">
        <div className="wf-cell-actions">
          <button type="button" className="button secondary small" onClick={onLog}>
            <FileText size={14} /> Invoices
          </button>
          {!ro && (
            <button
              type="button"
              className="button primary small"
              disabled={!dirty || busy}
              onClick={() => void save()}
            >
              Save
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// Billing tab of a mandate.
export function BillingEditor({ matter }: { matter: Matter }) {
  const { billingByMatter } = useWF();
  const b = billingByMatter.get(matter.id) ?? blank(matter.id);
  return <BillingCard key={b.revision} billing={b} />;
}

function BillingCard({ billing }: { billing: MatterBilling }) {
  const { caps } = useWF();
  const { draft, set, dirty, save, busy } = useBillingDraft(billing);
  const ro = !caps.editBilling;
  return (
    <div className="wf-split">
      <section className="card wf-section" aria-labelledby="wf-bill-h">
        <h2 id="wf-bill-h">Engagement and fee</h2>
        <fieldset className="wf-plain" disabled={ro}>
          <div className="wf-grid two">
            <Field label="Engagement letter">
              <select value={draft.elStatus} onChange={(e) => set('elStatus', e.target.value as ElStatus)}>
                {EL_STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Invoicing">
              <select
                value={draft.invoiceStatus}
                onChange={(e) => set('invoiceStatus', e.target.value as InvoiceStatus)}
              >
                {INVOICE_STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <MoneyInput label="Agreed fee" value={draft.feePaise} onChange={(v) => set('feePaise', v)} />
            <div className="wf-field">
              <span>Billed and outstanding</span>
              <p>
                {formatINR(billing.billedPaise)} billed,{' '}
                {formatINR(outstanding({ feePaise: draft.feePaise, billedPaise: billing.billedPaise }))}{' '}
                outstanding
              </p>
            </div>
          </div>
          <Field label="Billing notes">
            <textarea rows={3} value={draft.adminNotes} onChange={(e) => set('adminNotes', e.target.value)} />
          </Field>
        </fieldset>
        {!ro && (
          <div className="wf-form-actions">
            <button
              type="button"
              className="button primary"
              disabled={!dirty || busy}
              onClick={() => void save()}
            >
              Save billing
            </button>
          </div>
        )}
      </section>
      <section className="card wf-section" aria-labelledby="wf-inv-h">
        <h2 id="wf-inv-h">Invoice log</h2>
        <InvoiceLog matterId={billing.matterId} />
      </section>
    </div>
  );
}

export function InvoiceLog({ matterId }: { matterId: string }) {
  const { run, caps, today, reload, notify } = useWF();
  const list = useRemote('invoices:' + matterId, () => run('invoices.list', { matterId }));
  const [invoiceNo, setInvoiceNo] = useState('');
  const [date, setDate] = useState<string | null>(today);
  const [amount, setAmount] = useState<number | null>(null);
  const [entity, setEntity] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const invoices = [...(list.data ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const total = invoices.reduce((s, i) => s + i.amountPaise, 0);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!invoiceNo.trim()) return setError('Enter the invoice number.');
    if (!date) return setError('Choose the invoice date.');
    if (!amount || amount <= 0) return setError('Enter an amount greater than zero.');
    setBusy(true);
    const saved = await run(
      'invoice.create',
      {
        matterId,
        invoice: {
          invoiceNo: invoiceNo.trim(),
          date,
          amountPaise: amount,
          entity: entity.trim(),
          notes: notes.trim(),
        },
      },
      { onError: setError },
    );
    setBusy(false);
    if (saved) {
      setInvoiceNo('');
      setAmount(null);
      setNotes('');
      setFormKey((k) => k + 1);
      notify('Invoice recorded');
      list.reload();
      await reload(); // the billed amount is derived on the server
    }
  };
  return (
    <div className="wf-stack small">
      {list.loading && !list.data ? (
        <p className="wf-loading">Loading invoices</p>
      ) : invoices.length ? (
        <TableWrap label="Invoices">
          <table className="wf-table">
            <thead>
              <tr>
                <th scope="col">Invoice</th>
                <th scope="col">Date</th>
                <th scope="col">Raised on</th>
                <th scope="col" className="num">
                  Amount
                </th>
                <th scope="col">
                  <span className="wf-sr">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td>
                    <strong>{i.invoiceNo}</strong>
                    {i.notes && <div className="wf-caption">{i.notes}</div>}
                    <div className="wf-caption">
                      Recorded by <PersonBadge person={i.createdBy} />
                    </div>
                  </td>
                  <td className="nowrap">{formatDate(i.date)}</td>
                  <td>{i.entity || '-'}</td>
                  <td className="num">{formatINR(i.amountPaise)}</td>
                  <td className="actions">
                    {caps.editBilling && (
                      <ConfirmButton
                        className="wf-icon-btn"
                        ariaLabel={`Delete invoice ${i.invoiceNo}`}
                        question="Delete this invoice?"
                        onConfirm={async () => {
                          if (await run('invoice.delete', { id: i.id })) {
                            notify('Invoice deleted');
                            list.reload();
                            await reload();
                          }
                        }}
                      >
                        <Trash2 size={15} />
                      </ConfirmButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={3}>
                  Total billed
                </th>
                <td className="num">
                  <strong>{formatINR(total)}</strong>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </TableWrap>
      ) : (
        <p className="wf-empty-line">No invoices recorded.</p>
      )}
      {caps.editBilling && (
        <form onSubmit={add} className="wf-invoice-form" aria-label="Record an invoice">
          <h3 className="wf-h3">Record an invoice</h3>
          <div className="wf-grid two">
            <Field label="Invoice number">
              <input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
            </Field>
            <DateInput label="Invoice date" value={date} onChange={setDate} required />
            <MoneyInput key={formKey} label="Amount" value={amount} onChange={setAmount} required />
            <Field label="Raised on (entity)">
              <input value={entity} onChange={(e) => setEntity(e.target.value)} />
            </Field>
          </div>
          <Field label="Notes">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          {error && (
            <p className="wf-error" role="alert">
              {error}
            </p>
          )}
          <div className="wf-form-actions">
            <button type="submit" className="button primary" disabled={busy}>
              Record invoice
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
