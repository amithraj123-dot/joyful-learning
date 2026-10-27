'use client';
// Mandate Tasks tab: inline add and the mandate's open and completed tasks.
import { useState } from 'react';
import { Plus, Star } from 'lucide-react';
import type { Matter, PersonKey } from '../shared/types';
import { Toggle } from './components/Bits';
import { DateInput } from './components/Inputs';
import { PersonPicker } from './components/People';
import { byTaskOrder, isDone } from './lib';
import { useWF } from './store';
import { TaskDrawer } from './TaskDrawer';
import { TaskRow } from './TaskRow';
import { useTaskActions } from './taskActions';

export function MatterTasksTab({ matter }: { matter: Matter }) {
  const { tasks, focusTask, setFocusTask } = useWF();
  const actions = useTaskActions();
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState<PersonKey | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [priority, setPriority] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const own = tasks.filter((t) => t.matterId === matter.id);
  const open = own.filter((t) => !isDone(t)).sort(byTaskOrder);
  const done = own.filter(isDone).sort((a, b) => b.updatedAt - a.updatedAt);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError('Enter the task.');
    setBusy(true);
    setError('');
    const saved = await actions.create(
      { matterId: matter.id, title: title.trim(), assignee, dueDate, priority },
      { onError: setError },
    );
    setBusy(false);
    if (saved) {
      setTitle('');
      setDueDate(null);
      setPriority(false);
    }
  };

  return (
    <div className="card wf-section">
      <form className="wf-inline-add" onSubmit={add} aria-label="Add a task to this mandate">
        <input
          className="wf-input grow"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a task to this mandate"
          aria-label="New task"
        />
        <PersonPicker hideLabel label="Assign to" value={assignee} onChange={setAssignee} />
        <DateInput hideLabel label="Due date" value={dueDate} onChange={setDueDate} />
        <Toggle pressed={priority} onChange={setPriority} label="Priority">
          <Star size={15} aria-hidden="true" />
        </Toggle>
        <button type="submit" className="button primary" disabled={busy}>
          <Plus size={15} /> Add
        </button>
      </form>
      {error && (
        <p className="wf-error" role="alert">
          {error}
        </p>
      )}
      <h3 className="wf-h3">Open tasks ({open.length})</h3>
      {open.length ? (
        <ul className="wf-task-list">
          {open.map((t) => (
            <TaskRow key={t.id} task={t} onOpen={setFocusTask} showMatter={false} />
          ))}
        </ul>
      ) : (
        <p className="wf-empty-line">No open tasks on this mandate.</p>
      )}
      {done.length > 0 && (
        <>
          <h3 className="wf-h3">Completed ({done.length})</h3>
          <ul className="wf-task-list">
            {done.map((t) => (
              <TaskRow key={t.id} task={t} onOpen={setFocusTask} showMatter={false} />
            ))}
          </ul>
        </>
      )}
      {focusTask && <TaskDrawer taskId={focusTask} onClose={() => setFocusTask(null)} />}
    </div>
  );
}
