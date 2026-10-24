'use client';
// Clients and mandates: searchable client list with collapsible mandates, forms, trash and the mandate
// detail panel.
import { useMemo, useState } from 'react';
import {
  BriefcaseBusiness,
  ChevronDown,
  ChevronRight,
  Flame,
  Lock,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { MATTER_STATUS_LABELS, type Client, type Matter, type MatterStatus } from '../shared/types';
import { Chips, Empty, StatusPill } from './components/Bits';
import { ConfirmButton } from './components/ConfirmButton';
import { PersonList } from './components/People';
import { isDone, matterSort, plural, type Nav } from './lib';
import { ClientForm, MatterForm } from './MatterForms';
import { MatterDetail } from './MatterDetail';
import { useWF } from './store';
import { TrashView } from './TrashView';

type Filter = 'all' | MatterStatus;

export function MattersPage({ navigate }: { navigate: Nav }) {
  const { clients, matters, tasks, caps, focusMatter, setFocusMatter, matterById, run, dispatch, notify } =
    useWF();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [clientForm, setClientForm] = useState<Client | 'new' | null>(null);
  const [matterForm, setMatterForm] = useState<{ clientId: string } | null>(null);
  const [trash, setTrash] = useState(false);

  const taskCounts = useMemo(() => {
    const map = new Map<string, { done: number; total: number }>();
    for (const t of tasks) {
      const c = map.get(t.matterId) ?? { done: 0, total: 0 };
      c.total++;
      if (isDone(t)) c.done++;
      map.set(t.matterId, c);
    }
    return map;
  }, [tasks]);

  const q = search.trim().toLowerCase();
  const listed = useMemo(() => {
    return clients
      .map((c) => {
        const own = matters.filter((m) => m.clientId === c.id).sort(matterSort);
        const nameHit = !!q && c.name.toLowerCase().includes(q);
        const shown = own.filter(
          (m) =>
            (filter === 'all' || m.status === filter) &&
            (!q || nameHit || m.title.toLowerCase().includes(q) || m.type.toLowerCase().includes(q)),
        );
        return {
          client: c,
          all: own,
          shown,
          visible: (!q && filter === 'all') || shown.length > 0 || (nameHit && filter === 'all'),
        };
      })
      .filter((x) => x.visible);
  }, [clients, matters, q, filter]);

  const focused = focusMatter ? matterById.get(focusMatter) : undefined;
  if (focused)
    return <MatterDetail matter={focused} navigate={navigate} onBack={() => setFocusMatter(null)} />;
  if (trash) return <TrashView onBack={() => setTrash(false)} />;

  const count = (s: MatterStatus) => matters.filter((m) => m.status === s).length;
  const searching = !!q || filter !== 'all';
  const toggle = (id: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="wf-stack">
      <div className="wf-toolbar">
        <label className="search-box wf-search">
          <Search size={16} aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients, mandates or types"
            aria-label="Search clients and mandates"
          />
        </label>
        {caps.manageMatters && (
          <div className="wf-row">
            <button type="button" className="button ghost" onClick={() => setTrash(true)}>
              <Trash2 size={15} /> Trash
            </button>
            <button type="button" className="button primary" onClick={() => setClientForm('new')}>
              <Plus size={15} /> New client
            </button>
          </div>
        )}
      </div>
      <Chips
        label="Mandate status"
        value={filter}
        onChange={setFilter}
        options={[
          { id: 'all', label: 'All mandates', count: matters.length },
          ...(['active', 'urgent', 'on_hold', 'closed'] as const).map((s) => ({
            id: s,
            label: MATTER_STATUS_LABELS[s],
            count: count(s),
          })),
        ]}
      />
      {!clients.length ? (
        <Empty
          icon={BriefcaseBusiness}
          title="No clients yet"
          action={
            caps.manageMatters && (
              <button type="button" className="button primary" onClick={() => setClientForm('new')}>
                <Plus size={15} /> New client
              </button>
            )
          }
        >
          {caps.manageMatters
            ? 'Add a client, then the mandates you are working on for them.'
            : 'Clients and mandates are added by Assistant Managers and above. Mandates you are staffed on appear here.'}
        </Empty>
      ) : !listed.length ? (
        <p className="wf-empty-line">No clients or mandates match the search.</p>
      ) : (
        <ul className="wf-clients">
          {listed.map(({ client, all, shown }) => {
            const expanded = searching || open.has(client.id);
            const urgent = all.filter((m) => m.status === 'urgent').length;
            return (
              <li key={client.id} className="card wf-client">
                <div className="wf-client-head">
                  <button
                    type="button"
                    className="wf-client-toggle"
                    aria-expanded={expanded}
                    onClick={() => toggle(client.id)}
                  >
                    {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                    <span className="wf-client-name">{client.name}</span>
                    <span className="wf-caption">{plural(all.length, 'mandate')}</span>
                    {urgent > 0 && <StatusPill value="urgent" label={`${urgent} urgent`} />}
                    {all.filter((m) => m.status !== 'closed').length === 0 && all.length > 0 && (
                      <StatusPill value="closed" label="All closed" />
                    )}
                  </button>
                  {caps.manageMatters && (
                    <div className="wf-row wf-client-actions">
                      <button
                        type="button"
                        className="button ghost"
                        onClick={() => setMatterForm({ clientId: client.id })}
                      >
                        <Plus size={15} /> Mandate
                      </button>
                      <button
                        type="button"
                        className="wf-icon-btn"
                        aria-label={`Edit ${client.name}`}
                        onClick={() => setClientForm(client)}
                      >
                        <Pencil size={16} />
                      </button>
                      <ConfirmButton
                        className="wf-icon-btn"
                        ariaLabel={`Delete ${client.name}`}
                        question={`Move ${client.name} and its mandates to the trash?`}
                        confirmLabel="Move to trash"
                        onConfirm={async () => {
                          if (await run('client.delete', { id: client.id, baseRevision: client.revision })) {
                            dispatch({ type: 'clientGone', id: client.id });
                            notify('Client moved to the trash');
                          }
                        }}
                      >
                        <Trash2 size={16} />
                      </ConfirmButton>
                    </div>
                  )}
                </div>
                {expanded && (
                  <div className="wf-client-body">
                    {client.notes && <p className="wf-caption wf-client-notes">{client.notes}</p>}
                    {!shown.length ? (
                      <p className="wf-empty-line">No mandates{searching ? ' match' : ' yet'}.</p>
                    ) : (
                      <MatterGroups matters={shown} counts={taskCounts} onOpen={setFocusMatter} />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {clientForm && (
        <ClientForm
          client={clientForm === 'new' ? undefined : clientForm}
          onClose={(saved) => {
            setClientForm(null);
            if (saved) setOpen((o) => new Set(o).add(saved.id));
          }}
        />
      )}
      {matterForm && (
        <MatterForm
          clientId={matterForm.clientId}
          onClose={(saved) => {
            setMatterForm(null);
            if (saved) setFocusMatter(saved.id);
          }}
        />
      )}
    </div>
  );
}

function MatterGroups({
  matters,
  counts,
  onOpen,
}: {
  matters: Matter[];
  counts: Map<string, { done: number; total: number }>;
  onOpen: (id: string) => void;
}) {
  const groups = [
    { title: 'High priority', list: matters.filter((m) => m.priority && m.status !== 'closed') },
    { title: 'Standard mandates', list: matters.filter((m) => !m.priority && m.status !== 'closed') },
    { title: 'Closed', list: matters.filter((m) => m.status === 'closed') },
  ].filter((g) => g.list.length);
  return (
    <>
      {groups.map((g) => (
        <section key={g.title} aria-label={g.title}>
          {groups.length > 1 && <h3 className="wf-group-label">{g.title}</h3>}
          <ul className="wf-matters">
            {g.list.map((m) => {
              const c = counts.get(m.id) ?? { done: 0, total: 0 };
              return (
                <li key={m.id} className={m.status === 'closed' ? 'closed' : ''}>
                  <button type="button" className="wf-matter-row" onClick={() => onOpen(m.id)}>
                    <span className="wf-matter-title">
                      {m.priority && <Flame size={15} className="wf-red" aria-label="High priority" />}
                      {m.restricted && <Lock size={14} aria-label="Restricted" />}
                      {m.title}
                    </span>
                    <span className="wf-matter-meta">
                      <span className="wf-type">{m.type || 'Other'}</span>
                      <StatusPill value={m.status} label={MATTER_STATUS_LABELS[m.status]} />
                      <span className="wf-caption">{m.stage}</span>
                      <span className="wf-caption">
                        {c.done}/{c.total} tasks
                      </span>
                      <PersonList people={m.team} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
