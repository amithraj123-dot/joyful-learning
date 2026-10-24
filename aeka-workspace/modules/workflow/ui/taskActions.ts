'use client';
// Task mutations shared by the Tasks page, the mandate Tasks tab, the drawer and the Overview.
import { useCallback } from 'react';
import type { TaskInput } from '../shared/contract';
import { SIGN_OFF_STATUSES, type Matter, type Task } from '../shared/types';
import { taskInput, useWF, type RunOptions } from './store';

export const MAKER_CHECKER_RULE =
  'When a preparer is recorded, a task can be sent to the client or completed only after a different person is recorded as reviewer.';

export function signOffProblem(t: Pick<TaskInput, 'status' | 'preparedBy' | 'reviewedBy'>) {
  if (!SIGN_OFF_STATUSES.includes(t.status) || !t.preparedBy) return '';
  if (!t.reviewedBy) return 'Record a reviewer before moving this task to ' + t.status + '.';
  if (t.reviewedBy === t.preparedBy) return 'The reviewer must be a different person from the preparer.';
  return '';
}

export function useTaskActions() {
  const { run, dispatch, caps, meEmail, matterById, notify } = useWF();

  const canEdit = useCallback(
    (t: Task, matter?: Matter) => {
      const m = matter ?? matterById.get(t.matterId);
      return (
        caps.manageMatters ||
        t.assignee === meEmail ||
        t.createdBy === meEmail ||
        !!m?.team.includes(meEmail)
      );
    },
    [caps.manageMatters, meEmail, matterById],
  );
  const canDelete = useCallback(
    (t: Task) => caps.manageMatters || t.createdBy === meEmail,
    [caps.manageMatters, meEmail],
  );

  const update = useCallback(
    async (t: Task, patch: Partial<TaskInput>, opts?: RunOptions) => {
      const next = { ...taskInput(t), ...patch };
      const problem = signOffProblem(next);
      if (problem) {
        if (opts?.onError) opts.onError(problem);
        else notify(problem);
        return undefined;
      }
      const saved = await run('task.update', { id: t.id, task: next, baseRevision: t.revision }, opts);
      if (saved) dispatch({ type: 'task', task: saved });
      return saved;
    },
    [run, dispatch, notify],
  );

  const create = useCallback(
    async (task: Partial<TaskInput> & Pick<TaskInput, 'matterId' | 'title'>, opts?: RunOptions) => {
      const saved = await run(
        'task.create',
        {
          task: {
            status: 'Preparing',
            assignee: null,
            preparedBy: null,
            reviewedBy: null,
            dueDate: null,
            priority: false,
            notes: '',
            steps: [],
            ...task,
          },
        },
        opts,
      );
      if (saved) dispatch({ type: 'task', task: saved });
      return saved;
    },
    [run, dispatch],
  );

  const remove = useCallback(
    async (t: Task) => {
      const ok = await run('task.delete', { id: t.id, baseRevision: t.revision });
      if (ok) dispatch({ type: 'taskGone', id: t.id });
      return ok;
    },
    [run, dispatch],
  );

  // Toggling completion moves the status between Completed and Preparing; "done" is derived from status.
  const toggleDone = useCallback(
    (t: Task) => update(t, { status: t.status === 'Completed' ? 'Preparing' : 'Completed' }),
    [update],
  );

  return { update, create, remove, toggleDone, canEdit, canDelete };
}
