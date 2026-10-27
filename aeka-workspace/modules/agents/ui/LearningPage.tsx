'use client';
// Memory and learning: every lesson my agents follow, grouped by agent, with where it came from and
// how often it was used. Lessons can be removed, and added by hand for one agent or for all.
import { useCallback, useEffect, useId, useState } from 'react';
import { Brain, Trash2, TriangleAlert } from 'lucide-react';
import { ConfirmButton } from '../../workflow/ui/components/ConfirmButton';
import { Empty } from '../../workflow/ui/components/Bits';
import { agents } from '../shared/client';
import type { Agent, Lesson } from '../shared/types';
import { atLabel, errorMessage, MAX, plural, SOURCE_LABELS } from './lib';

export function LearningPage({
  navigate,
  notify,
  refreshKey,
}: {
  navigate: (p: string) => void;
  notify: (m: string) => void;
  refreshKey: number;
}) {
  const id = useId();
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [list, setList] = useState<Agent[]>([]);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [scope, setScope] = useState(''); // '' for every agent, else an agent id
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    try {
      const [l, a] = await Promise.all([agents('lessons.list', {}), agents('agents.list', {})]);
      setLessons(l);
      setList(a.agents);
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

  const add = async () => {
    setSaving(true);
    setFormError('');
    try {
      const l = await agents('lesson.save', { agentId: scope || null, text: text.trim() });
      setLessons((x) => [l, ...x]);
      setText('');
      notify('Lesson saved. It applies from the next run.');
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (l: Lesson) => {
    try {
      await agents('lesson.delete', { id: l.id });
      setLessons((x) => x.filter((y) => y.id !== l.id));
      notify('Lesson removed.');
    } catch (e) {
      notify(errorMessage(e));
    }
  };

  // "For every agent" first, then each agent in list order, then lessons of agents no longer listed.
  const names = new Map(list.map((a) => [a.id, a.name]));
  const groups: { key: string; title: string; items: Lesson[] }[] = [
    { key: 'all', title: 'For every agent', items: lessons.filter((l) => !l.agentId) },
    ...list.map((a) => ({ key: a.id, title: a.name, items: lessons.filter((l) => l.agentId === a.id) })),
    {
      key: 'gone',
      title: 'Other agents',
      items: lessons.filter((l) => l.agentId && !names.has(l.agentId)),
    },
  ].filter((g) => g.items.length);

  return (
    <div className="ag-page">
      <section className="ag-card ag-explain" aria-labelledby={id + '-how'}>
        <h2 id={id + '-how'}>How your agents learn</h2>
        <p>
          Learning is automatic. A lesson is drawn when you rate a run poor or leave a comment, when you
          reject something an agent asked to do, and when a run has a failed step. Agents also save lessons
          for themselves. Every lesson applies to later runs at once.
        </p>
        <p>
          Nothing here is hidden: remove any lesson that is wrong, or add your own. Agents also use what the
          Assistant remembers about you.
        </p>
        <div className="ag-actions">
          <button type="button" className="button secondary" onClick={() => navigate('assistant/memory')}>
            <Brain size={16} aria-hidden="true" /> Open the Assistant&apos;s memory
          </button>
        </div>
      </section>

      <section className="ag-card" aria-labelledby={id + '-add'}>
        <h2 id={id + '-add'}>Add a lesson</h2>
        <div className="wf-field">
          <label htmlFor={id + '-text'}>Lesson</label>
          <textarea
            id={id + '-text'}
            rows={2}
            value={text}
            maxLength={MAX.lesson}
            placeholder="For example: address clients by their first name"
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <div className="wf-field">
          <label htmlFor={id + '-scope'}>Applies to</label>
          <select id={id + '-scope'} value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="">Every agent</option>
            {list.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        {formError && (
          <p className="ag-error" role="alert">
            {formError}
          </p>
        )}
        <div className="ag-actions">
          <button
            type="button"
            className="button primary"
            disabled={saving || !text.trim()}
            onClick={() => void add()}
          >
            {saving ? 'Saving…' : 'Save lesson'}
          </button>
        </div>
      </section>

      {phase === 'loading' && <p className="ag-note">Loading lessons…</p>}
      {phase === 'error' && (
        <div className="ag-card ag-banner" role="alert">
          <TriangleAlert size={22} aria-hidden="true" />
          <div>
            <strong>Lessons could not be loaded</strong>
            <p>{error}</p>
          </div>
          <button type="button" className="button secondary" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}
      {phase === 'ready' && groups.length === 0 && (
        <Empty icon={Brain} title="No lessons yet">
          Rate your agents&apos; runs, or add a lesson above, and they appear here.
        </Empty>
      )}
      {phase === 'ready' &&
        groups.map((g) => (
          <section key={g.key} className="ag-section" aria-labelledby={id + '-g-' + g.key}>
            <h2 id={id + '-g-' + g.key}>
              {g.title} <span className="ag-count">{g.items.length}</span>
            </h2>
            <ul className="ag-lessons ag-card">
              {g.items.map((l) => (
                <li key={l.id}>
                  <span className="ag-lesson-text">{l.text}</span>
                  <span className="ag-meta">
                    {SOURCE_LABELS[l.source]}, used in {plural(l.uses, 'run')}, added {atLabel(l.createdAt)}
                  </span>
                  <ConfirmButton
                    className="button ghost small"
                    question="Remove this lesson?"
                    confirmLabel="Remove"
                    ariaLabel={'Remove lesson: ' + l.text}
                    onConfirm={() => remove(l)}
                  >
                    <Trash2 size={15} aria-hidden="true" /> Remove
                  </ConfirmButton>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
