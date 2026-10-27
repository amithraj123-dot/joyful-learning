'use client';
// One task in a list: completion toggle, title (opens the drawer), context, status, assignee and priority.
import { CircleCheck, Circle, Star } from 'lucide-react';
import { TASK_STATUSES, type Task, type TaskStatus } from '../shared/types';
import { StatusPill } from './components/Bits';
import { PersonBadge, PersonPicker } from './components/People';
import { formatDate, isDone } from './lib';
import { useMatterLabel, useWF } from './store';
import { useTaskActions } from './taskActions';

export function TaskRow({
  task,
  onOpen,
  onOpenMatter,
  showMatter = true,
  compact,
}: {
  task: Task;
  onOpen: (id: string) => void;
  onOpenMatter?: (matterId: string) => void;
  showMatter?: boolean;
  compact?: boolean;
}) {
  const { today, meEmail } = useWF();
  const label = useMatterLabel();
  const actions = useTaskActions();
  const editable = actions.canEdit(task);
  const done = isDone(task);
  const overdue = !done && !!task.dueDate && task.dueDate < today;
  const stepsDone = task.steps.filter((s) => s.done).length;
  return (
    <li className={'wf-task' + (done ? ' done' : '') + (task.priority ? ' priority' : '')}>
      <button
        type="button"
        className="wf-icon-btn wf-done-btn"
        aria-pressed={done}
        aria-label={done ? `Reopen ${task.title}` : `Mark ${task.title} complete`}
        disabled={!editable}
        onClick={() => void actions.toggleDone(task)}
      >
        {done ? <CircleCheck size={20} /> : <Circle size={20} />}
      </button>
      <div className="wf-task-main">
        <button type="button" className="wf-task-title" onClick={() => onOpen(task.id)}>
          {task.title}
        </button>
        <div className="wf-task-meta">
          {showMatter &&
            (onOpenMatter ? (
              <button type="button" className="wf-link" onClick={() => onOpenMatter(task.matterId)}>
                {label(task.matterId)}
              </button>
            ) : (
              <span>{label(task.matterId)}</span>
            ))}
          {task.dueDate && (
            <span className={overdue ? 'wf-overdue' : ''}>
              {overdue ? 'Overdue: ' : 'Due '}
              {formatDate(task.dueDate)}
            </span>
          )}
          {task.steps.length > 0 && (
            <span>
              {stepsDone}/{task.steps.length} steps
            </span>
          )}
          {task.preparedBy && (
            <span className="wf-inline-person">
              Prepared <PersonBadge person={task.preparedBy} />
            </span>
          )}
          {task.reviewedBy && (
            <span className="wf-inline-person">
              Reviewer <PersonBadge person={task.reviewedBy} />
            </span>
          )}
          {task.status === 'In Review' && task.reviewedBy === meEmail && (
            <StatusPill value="In Review" label="Awaiting your review" tone="red" />
          )}
        </div>
      </div>
      <div className="wf-task-controls">
        {editable ? (
          <select
            className="wf-select-sm"
            aria-label={`Status of ${task.title}`}
            value={task.status}
            onChange={(e) => void actions.update(task, { status: e.target.value as TaskStatus })}
          >
            {TASK_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        ) : (
          <StatusPill value={task.status} />
        )}
        {!compact &&
          (editable ? (
            <span className="wf-select-sm-wrap">
              <PersonPicker
                hideLabel
                label={`Assignee of ${task.title}`}
                value={task.assignee}
                onChange={(v) => void actions.update(task, { assignee: v })}
              />
            </span>
          ) : (
            <PersonBadge person={task.assignee} />
          ))}
        <button
          type="button"
          className={'wf-icon-btn wf-star' + (task.priority ? ' on' : '')}
          aria-pressed={task.priority}
          aria-label={`Priority: ${task.title}`}
          disabled={!editable}
          onClick={() => void actions.update(task, { priority: !task.priority })}
        >
          <Star size={17} />
        </button>
      </div>
    </li>
  );
}
