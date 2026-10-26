'use client';
// Memory: what the member has asked the assistant to remember, grouped by category.
import { useState, type FormEvent } from 'react';
import { Brain, Pencil, Plus, Trash2 } from 'lucide-react';
import { assistant } from '../shared/client';
import { MEMORY_CATEGORIES, MEMORY_LABELS, type Memory, type MemoryCategory } from '../shared/types';
import { Modal } from '../../workflow/ui/components/Modal';
import { ConfirmButton } from '../../workflow/ui/components/ConfirmButton';
import { Chips, Empty } from '../../workflow/ui/components/Bits';
import { Field } from '../../workflow/ui/components/Inputs';
import { useAssistant } from './context';
import { InlineError, LoadError, Loading } from './Bits';
import { errorMessage, formatWhen, useLoad } from './lib';

const HINTS: Record<MemoryCategory, string> = {
  preference: 'For example: I prefer calls before 11 am.',
  style: 'For example: sign off as "Regards, Amith"; keep replies to clients short and formal.',
  person: 'For example: Rahul Mehta is the CFO of Vista Earth.',
  client: 'For example: Vista Earth wants every advice note reviewed by a partner.',
  general: 'Anything else the assistant should keep in mind.',
};

function MemoryEditor({
  memory,
  category,
  onClose,
  onSaved,
}: {
  memory: Memory | null;
  category: MemoryCategory;
  onClose: () => void;
  onSaved: (m: Memory) => void;
}) {
  const { notify } = useAssistant();
  const [cat, setCat] = useState<MemoryCategory>(memory?.category ?? category);
  const [title, setTitle] = useState(memory?.title ?? '');
  const [content, setContent] = useState(memory?.content ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return setError('Give the memory a short title and the detail to remember.');
    setBusy(true);
    setError('');
    try {
      const saved = await assistant('memory.save', {
        ...(memory ? { id: memory.id } : {}),
        memory: { category: cat, title: title.trim(), content: content.trim() },
      });
      onSaved(saved);
      notify(memory ? 'Memory saved' : 'Memory added');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={memory ? 'Edit memory' : 'Add a memory'}
      onClose={onClose}
      footer={
        <div className="wf-form-actions as-actions-end">
          <button type="button" className="button ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="as-memory-edit" className="button primary" disabled={busy}>
            {busy ? 'Saving' : 'Save'}
          </button>
        </div>
      }
    >
      <form id="as-memory-edit" onSubmit={save}>
        <Field label="Category">
          <select value={cat} onChange={(e) => setCat(e.target.value as MemoryCategory)}>
            {MEMORY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {MEMORY_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Title">
          <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} data-autofocus />
        </Field>
        <Field label="What to remember" hint={HINTS[cat]}>
          <textarea rows={5} value={content} maxLength={2000} onChange={(e) => setContent(e.target.value)} />
        </Field>
        <p className="wf-caption">Do not store passwords, bank details or other secrets here.</p>
        <InlineError message={error} />
      </form>
    </Modal>
  );
}

type Filter = 'all' | MemoryCategory;

export function MemoryPage() {
  const { notify } = useAssistant();
  const list = useLoad(() => assistant('memory.list', {}));
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<{ memory: Memory | null } | null>(null);
  const put = (m: Memory) =>
    list.set((items) => (items.some((x) => x.id === m.id) ? items.map((x) => (x.id === m.id ? m : x)) : [m, ...items]));
  const remove = async (m: Memory) => {
    try {
      await assistant('memory.delete', { id: m.id });
      list.set((items) => items.filter((x) => x.id !== m.id));
      notify('Memory deleted');
    } catch (e) {
      notify(errorMessage(e));
    }
  };

  const intro = (
    <div className="wf-note as-intro">
      Aeka uses these memories in chat and when drafting email replies in your voice. They are private to you;
      nobody else in the firm, administrators included, can see them. Do not store passwords.
    </div>
  );
  if (list.phase === 'loading')
    return (
      <div className="as-stack">
        {intro}
        <Loading>Loading your memory</Loading>
      </div>
    );
  if (list.phase === 'error' || !list.data)
    return (
      <div className="as-stack">
        {intro}
        <LoadError title="Your memory could not be loaded" message={list.error} status={list.status} onRetry={list.retry} />
      </div>
    );
  const items = list.data;
  const counts = Object.fromEntries(MEMORY_CATEGORIES.map((c) => [c, items.filter((m) => m.category === c).length]));
  const groups = MEMORY_CATEGORIES.filter((c) => (filter === 'all' || filter === c) && counts[c] > 0);
  return (
    <div className="as-stack">
      {intro}
      <div className="as-toolbar">
        <Chips<Filter>
          label="Category"
          value={filter}
          onChange={setFilter}
          options={[
            { id: 'all', label: 'All', count: items.length },
            ...MEMORY_CATEGORIES.filter((c) => counts[c] > 0).map((c) => ({
              id: c,
              label: MEMORY_LABELS[c],
              count: counts[c],
            })),
          ]}
        />
        <button type="button" className="button primary" onClick={() => setEditing({ memory: null })}>
          <Plus size={15} aria-hidden="true" /> Add a memory
        </button>
      </div>
      <InlineError message={list.error} onRetry={list.retry} />
      {items.length === 0 ? (
        <Empty icon={Brain} title="Nothing remembered yet">
          Add something here, or tell Aeka in chat, for example: remember that I sign emails as Amith.
        </Empty>
      ) : (
        groups.map((c) => (
          <section key={c} className="as-memory-group" aria-labelledby={'as-mem-' + c}>
            <h3 id={'as-mem-' + c} className="wf-h3">
              {MEMORY_LABELS[c]} <span className="as-count">{counts[c]}</span>
            </h3>
            <ul className="as-memories">
              {items
                .filter((m) => m.category === c)
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .map((m) => (
                  <li key={m.id} className="as-memory">
                    <div className="as-memory-main">
                      <strong>{m.title}</strong>
                      <p className="wf-pre">{m.content}</p>
                      <small>Updated {formatWhen(m.updatedAt)}</small>
                    </div>
                    <div className="as-item-actions">
                      <button
                        type="button"
                        className="wf-icon-btn as-tap"
                        aria-label={'Edit ' + m.title}
                        onClick={() => setEditing({ memory: m })}
                      >
                        <Pencil size={16} />
                      </button>
                      <ConfirmButton
                        className="wf-icon-btn as-tap"
                        ariaLabel={'Delete ' + m.title}
                        question="Forget this?"
                        confirmLabel="Forget"
                        onConfirm={() => remove(m)}
                      >
                        <Trash2 size={16} />
                      </ConfirmButton>
                    </div>
                  </li>
                ))}
            </ul>
          </section>
        ))
      )}
      {editing && (
        <MemoryEditor
          memory={editing.memory}
          category={filter === 'all' ? 'general' : filter}
          onClose={() => setEditing(null)}
          onSaved={put}
        />
      )}
    </div>
  );
}
