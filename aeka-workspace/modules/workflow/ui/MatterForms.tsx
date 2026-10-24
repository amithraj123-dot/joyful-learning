'use client';
// Create and edit dialogs for clients and mandates (Manager and above).
import { useState } from 'react';
import type { MatterInput } from '../shared/contract';
import {
  MATTER_STAGES,
  MATTER_STATUSES,
  MATTER_STATUS_LABELS,
  MATTER_TYPES,
  type Client,
  type Matter,
  type MatterStage,
  type MatterStatus,
} from '../shared/types';
import { Toggle } from './components/Bits';
import { Field } from './components/Inputs';
import { Modal } from './components/Modal';
import { TeamPicker } from './components/People';
import { matterInput, useWF } from './store';

export function ClientForm({ client, onClose }: { client?: Client; onClose: (saved?: Client) => void }) {
  const { run, dispatch, notify } = useWF();
  const [name, setName] = useState(client?.name ?? '');
  const [notes, setNotes] = useState(client?.notes ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Enter the client name.');
    setBusy(true);
    const input = { name: name.trim(), notes };
    const saved = client
      ? await run('client.update', { id: client.id, client: input, baseRevision: client.revision }, { onError: setError })
      : await run('client.create', { client: input }, { onError: setError });
    setBusy(false);
    if (saved) {
      dispatch({ type: 'client', client: saved });
      notify(client ? 'Client updated' : 'Client added');
      onClose(saved);
    }
  };
  return (
    <Modal title={client ? 'Edit client' : 'New client'} onClose={() => onClose()}>
      <form onSubmit={submit}>
        <Field label="Client or group name">
          <input value={name} onChange={(e) => setName(e.target.value)} data-autofocus required maxLength={200} />
        </Field>
        <Field label="Notes">
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {error && (
          <p className="wf-error" role="alert">
            {error}
          </p>
        )}
        <div className="wf-form-actions">
          <button type="button" className="button secondary" onClick={() => onClose()}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={busy}>
            {client ? 'Save client' : 'Add client'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const CUSTOM = '__custom';

export function MatterForm({
  matter,
  clientId,
  onClose,
}: {
  matter?: Matter;
  clientId?: string;
  onClose: (saved?: Matter) => void;
}) {
  const { run, dispatch, notify, clients, meEmail } = useWF();
  const [m, setM] = useState<MatterInput>(() =>
    matter
      ? matterInput(matter)
      : {
          clientId: clientId || clients[0]?.id || '',
          title: '',
          type: 'Structuring',
          status: 'active',
          stage: 'Term Sheet and Structuring',
          priority: false,
          note: '',
          team: meEmail ? [meEmail] : [],
          restricted: false,
          peerFeedbackVisible: false,
          isDeal: false,
        },
  );
  const standard = (MATTER_TYPES as readonly string[]).includes(m.type);
  const [custom, setCustom] = useState(!standard);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof MatterInput>(k: K, v: MatterInput[K]) => setM((x) => ({ ...x, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!m.title.trim()) return setError('Enter the mandate title.');
    if (!m.clientId) return setError('Choose a client.');
    const input = { ...m, title: m.title.trim(), type: m.type.trim() || 'Other' };
    setBusy(true);
    const saved = matter
      ? await run('matter.update', { id: matter.id, matter: input, baseRevision: matter.revision }, { onError: setError })
      : await run('matter.create', { matter: input }, { onError: setError });
    setBusy(false);
    if (saved) {
      dispatch({ type: 'matter', matter: saved });
      notify(matter ? 'Mandate updated' : 'Mandate added');
      onClose(saved);
    }
  };

  return (
    <Modal title={matter ? 'Edit mandate' : 'New mandate'} onClose={() => onClose()} wide>
      <form onSubmit={submit}>
        <div className="wf-grid two">
          <Field label="Mandate title">
            <input value={m.title} onChange={(e) => set('title', e.target.value)} data-autofocus maxLength={200} />
          </Field>
          <Field label="Client">
            <select value={m.clientId} onChange={(e) => set('clientId', e.target.value)}>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Type">
            <select
              value={custom ? CUSTOM : m.type}
              onChange={(e) => {
                if (e.target.value === CUSTOM) {
                  setCustom(true);
                  set('type', '');
                } else {
                  setCustom(false);
                  set('type', e.target.value);
                  if (e.target.value.startsWith('Deal')) set('isDeal', true);
                }
              }}
            >
              {MATTER_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
              <option value={CUSTOM}>Custom type</option>
            </select>
          </Field>
          {custom && (
            <Field label="Custom type">
              <input value={m.type} onChange={(e) => set('type', e.target.value)} maxLength={60} />
            </Field>
          )}
          <Field label="Status">
            <select value={m.status} onChange={(e) => set('status', e.target.value as MatterStatus)}>
              {MATTER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {MATTER_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Stage">
            <select value={m.stage} onChange={(e) => set('stage', e.target.value as MatterStage)}>
              {MATTER_STAGES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
        </div>
        <TeamPicker value={m.team} onChange={(v) => set('team', v)} />
        <div className="wf-toggles">
          <Toggle pressed={m.priority} onChange={(v) => set('priority', v)}>
            High priority
          </Toggle>
          <Toggle pressed={m.isDeal} onChange={(v) => set('isDeal', v)}>
            Deal mandate (shows the deal tracker)
          </Toggle>
          <Toggle pressed={m.restricted} onChange={(v) => set('restricted', v)}>
            Restricted to the team, Directors and Partners
          </Toggle>
        </div>
        <Field label="Status note or executive summary">
          <textarea rows={4} value={m.note} onChange={(e) => set('note', e.target.value)} />
        </Field>
        {error && (
          <p className="wf-error" role="alert">
            {error}
          </p>
        )}
        <div className="wf-form-actions">
          <button type="button" className="button secondary" onClick={() => onClose()}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={busy}>
            {matter ? 'Save mandate' : 'Add mandate'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
