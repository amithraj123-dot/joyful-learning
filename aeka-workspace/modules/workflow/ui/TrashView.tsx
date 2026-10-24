'use client';
// Trash: deleted clients, mandates and tasks, restorable by Assistant Managers and above.
import { ArrowLeft, RotateCcw, Trash2 } from 'lucide-react';
import { Empty } from './components/Bits';
import { formatStamp } from './lib';
import { useRemote, useWF } from './store';

export function TrashView({ onBack }: { onBack: () => void }) {
  const { run, dispatch, notify, clientById, matterById, reload } = useWF();
  const { data, loading, reload: refetch } = useRemote('trash', () => run('trash', {}));
  const restore = async (kind: 'client' | 'matter' | 'task', id: string) => {
    let ok = false;
    if (kind === 'client') {
      ok = !!(await run('client.restore', { id }));
      if (ok) await reload();
    } else if (kind === 'matter') {
      const matter = await run('matter.restore', { id });
      if (matter) dispatch({ type: 'matter', matter });
      ok = !!matter;
    } else {
      const task = await run('task.restore', { id });
      if (task) dispatch({ type: 'task', task });
      ok = !!task;
    }
    if (ok) {
      notify('Restored');
      refetch();
    }
  };
  const matterName = (id: string) =>
    matterById.get(id)?.title ?? data?.matters.find((m) => m.id === id)?.title ?? 'a deleted mandate';
  const clientName = (id: string) =>
    clientById.get(id)?.name ?? data?.clients.find((c) => c.id === id)?.name ?? 'a deleted client';
  const empty = data && !data.clients.length && !data.matters.length && !data.tasks.length;
  return (
    <div className="wf-stack">
      <div className="wf-toolbar">
        <button type="button" className="button ghost" onClick={onBack}>
          <ArrowLeft size={15} /> Back to clients and mandates
        </button>
      </div>
      <section className="card wf-section" aria-labelledby="wf-trash-h">
        <h2 id="wf-trash-h">Trash</h2>
        <p className="wf-caption">
          Deleted clients, mandates and tasks stay here and can be restored. Restoring a client also restores
          its mandates.
        </p>
        {loading && !data && <p className="wf-loading">Loading the trash</p>}
        {empty && <Empty icon={Trash2} title="The trash is empty" />}
        {data && (
          <>
            {[
              {
                kind: 'client' as const,
                title: 'Clients',
                rows: data.clients.map((c) => ({ id: c.id, name: c.name, sub: '', at: c.deletedAt })),
              },
              {
                kind: 'matter' as const,
                title: 'Mandates',
                rows: data.matters.map((m) => ({
                  id: m.id,
                  name: m.title,
                  sub: clientName(m.clientId),
                  at: m.deletedAt,
                })),
              },
              {
                kind: 'task' as const,
                title: 'Tasks',
                rows: data.tasks.map((t) => ({
                  id: t.id,
                  name: t.title,
                  sub: matterName(t.matterId),
                  at: t.deletedAt,
                })),
              },
            ]
              .filter((g) => g.rows.length)
              .map((g) => (
                <div key={g.kind}>
                  <h3 className="wf-h3">{g.title}</h3>
                  <ul className="wf-list">
                    {g.rows.map((r) => (
                      <li key={r.id} className="wf-list-row">
                        <div>
                          <strong>{r.name}</strong>
                          <p className="wf-caption">
                            {r.sub && `${r.sub}. `}
                            {r.at ? `Deleted ${formatStamp(r.at)}` : ''}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="button secondary"
                          onClick={() => void restore(g.kind, r.id)}
                        >
                          <RotateCcw size={15} /> Restore
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </>
        )}
      </section>
    </div>
  );
}
