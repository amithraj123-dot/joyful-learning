'use client';
// Activity trail: paged list of who changed what, for the firm or for one mandate.
import { useEffect, useEffectEvent, useState } from 'react';
import { Activity } from 'lucide-react';
import { formatStamp, type ActivityEntry } from './lib';
import { useWF } from './store';

const PAGE = 50;

function useActivity(filter: { filterModule?: string; target?: string }, limit: number) {
  const { runCore, matterById, clientById, tasks } = useWF();
  const key = JSON.stringify(filter) + limit;
  const [state, setState] = useState<{ key: string; items: ActivityEntry[]; more: boolean }>({
    key: '',
    items: [],
    more: false,
  });
  const fetchPage = useEffectEvent((before?: number) =>
    runCore<ActivityEntry[]>('activity.list', { ...filter, limit, ...(before ? { before } : {}) }),
  );
  useEffect(() => {
    let alive = true;
    void fetchPage().then((items) => {
      if (alive) setState({ key, items: items ?? [], more: (items?.length ?? 0) >= limit });
    });
    return () => {
      alive = false;
    };
  }, [key, limit]);
  const loadMore = async () => {
    const last = state.items[state.items.length - 1];
    const items = await runCore<ActivityEntry[]>('activity.list', { ...filter, limit, before: last?.at });
    if (items) setState((s) => ({ ...s, items: [...s.items, ...items], more: items.length >= limit }));
  };
  // Name the record an entry refers to, when it is one the viewer can see.
  const targetName = (id: string) => {
    const m = matterById.get(id);
    if (m) return `Mandate: ${m.title}`;
    const c = clientById.get(id);
    if (c) return `Client: ${c.name}`;
    const t = tasks.find((x) => x.id === id);
    if (t) return `Task: ${t.title}`;
    return '';
  };
  return {
    items: state.key === key ? state.items : [],
    loading: state.key !== key,
    more: state.more,
    loadMore,
    targetName,
  };
}

export function ActivityList({
  target,
  filterModule,
  limit = PAGE,
  paged = true,
}: {
  target?: string;
  filterModule?: string;
  limit?: number;
  paged?: boolean;
}) {
  const { items, loading, more, loadMore, targetName } = useActivity(
    { ...(target ? { target } : {}), ...(filterModule ? { filterModule } : {}) },
    limit,
  );
  const [busy, setBusy] = useState(false);
  if (loading) return <p className="wf-loading">Loading activity</p>;
  if (!items.length) return <p className="wf-empty-line">No activity recorded yet.</p>;
  return (
    <>
      <ol className="wf-activity">
        {items.map((a) => (
          <li key={a.id}>
            <time className="wf-caption">{formatStamp(a.at)}</time>
            <div>
              <p>
                <strong>{a.actorName}</strong> {a.summary}
              </p>
              <p className="wf-caption">
                {[
                  a.module === 'core' ? 'Workspace' : a.module === 'workflow' ? 'Workflow' : a.module,
                  targetName(a.target),
                ]
                  .filter(Boolean)
                  .join(', ')}
              </p>
            </div>
          </li>
        ))}
      </ol>
      {paged && more && (
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await loadMore();
            setBusy(false);
          }}
        >
          Load earlier activity
        </button>
      )}
    </>
  );
}

export function ActivityPage() {
  const [scope, setScope] = useState('workflow');
  return (
    <div className="wf-stack">
      <div className="wf-toolbar">
        <label className="wf-inline-field">
          <span>Show</span>
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="workflow">Workflow changes</option>
            <option value="core">Membership and access changes</option>
            <option value="">Everything</option>
          </select>
        </label>
      </div>
      <section className="card wf-section" aria-label="Activity">
        <ActivityList key={scope} filterModule={scope || undefined} />
      </section>
      <p className="wf-caption">
        <Activity size={13} aria-hidden="true" /> The trail records who made each change and when; it never
        stores the content of notes.
      </p>
    </div>
  );
}
