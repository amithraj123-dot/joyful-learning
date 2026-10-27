'use client';
// Firm templates: agents partners have published for the firm. "Use this" copies one as my own
// agent, paused until I switch it on; the author or an administrator can delete a template.
import { useCallback, useEffect, useId, useState } from 'react';
import { Copy, LayoutTemplate, Trash2, TriangleAlert } from 'lucide-react';
import { callModule } from '../../../core/client/api';
import { ConfirmButton } from '../../workflow/ui/components/ConfirmButton';
import { Empty } from '../../workflow/ui/components/Bits';
import { agents } from '../shared/client';
import type { Template } from '../shared/types';
import { errorMessage, plural, triggerLabel } from './lib';

// What core "me" returns (only the fields used here).
interface Me {
  email: string;
  member: { isAdmin: boolean } | null;
}

export function TemplatesPage({
  notify,
  openAgent,
  refreshKey,
}: {
  notify: (m: string) => void;
  openAgent: (id: string) => void;
  refreshKey: number;
}) {
  const id = useId();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const [t, m] = await Promise.all([
        agents('templates.list', {}),
        callModule<Me>('core', 'me', {}).catch(() => null),
      ]);
      setTemplates(t);
      setMe(m);
      setPhase('ready');
      setError('');
    } catch (e) {
      setError(errorMessage(e));
      setPhase((x) => (x === 'ready' ? x : 'error'));
    }
  }, []);

  // The first load runs after the effect (never setting state within it).
  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load, refreshKey]);

  const copy = async (t: Template) => {
    setBusy(t.id);
    try {
      const agent = await agents('template.copy', { id: t.id });
      setTemplates((list) => list.map((x) => (x.id === t.id ? { ...x, copies: x.copies + 1 } : x)));
      notify('Copied as a paused agent. Switch it on when it suits you.');
      openAgent(agent.id);
    } catch (e) {
      notify(errorMessage(e));
    } finally {
      setBusy('');
    }
  };

  const remove = async (t: Template) => {
    try {
      await agents('template.delete', { id: t.id });
      setTemplates((list) => list.filter((x) => x.id !== t.id));
      notify(`Deleted the template ${t.name}.`);
    } catch (e) {
      notify(errorMessage(e));
    }
  };

  const mayDelete = (t: Template) =>
    !!me && (me.email.toLowerCase() === t.author.toLowerCase() || !!me.member?.isAdmin);

  return (
    <div className="ag-page">
      <p className="ag-note">
        Partners publish their agents here from the agent&apos;s panel. A copy starts paused and keeps its own
        notes and lessons.
      </p>
      {phase === 'loading' && <p className="ag-note">Loading templates…</p>}
      {phase === 'error' && (
        <div className="ag-card ag-banner" role="alert">
          <TriangleAlert size={22} aria-hidden="true" />
          <div>
            <strong>Templates could not be loaded</strong>
            <p>{error}</p>
          </div>
          <button type="button" className="button secondary" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}
      {phase === 'ready' && templates.length === 0 && (
        <Empty icon={LayoutTemplate} title="No firm templates yet">
          When a partner publishes one of their agents for the firm, it appears here.
        </Empty>
      )}
      {phase === 'ready' && templates.length > 0 && (
        <ul className="ag-list ag-grid" aria-label="Firm templates">
          {templates.map((t) => (
            <li key={t.id}>
              <article className="ag-card ag-template" aria-labelledby={id + '-' + t.id}>
                <h3 id={id + '-' + t.id}>{t.name}</h3>
                {t.description && <p>{t.description}</p>}
                <p className="ag-trigger-line">{triggerLabel(t.trigger)}</p>
                <details className="ag-details">
                  <summary>What it does</summary>
                  <p className="ag-pre">{t.instruction}</p>
                </details>
                <p className="ag-meta">
                  By {t.authorName || t.author},{' '}
                  {t.copies === 0
                    ? 'not copied yet'
                    : t.copies === 1
                      ? 'copied once'
                      : `copied ${plural(t.copies, 'time')}`}
                </p>
                <div className="ag-actions">
                  <button
                    type="button"
                    className="button primary"
                    disabled={!!busy}
                    onClick={() => void copy(t)}
                  >
                    <Copy size={16} aria-hidden="true" /> {busy === t.id ? 'Copying…' : 'Use this'}
                  </button>
                  {mayDelete(t) && (
                    <ConfirmButton
                      question="Delete this template for the firm?"
                      ariaLabel={'Delete template ' + t.name}
                      onConfirm={() => remove(t)}
                    >
                      <Trash2 size={16} aria-hidden="true" /> Delete
                    </ConfirmButton>
                  )}
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
