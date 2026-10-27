'use client';
// Overview: headline figures, my tasks, upcoming deadlines and recent activity.
import { ArrowUpRight } from 'lucide-react';
import { ActivityList } from './ActivityPage';
import { addDays, byTaskOrder, formatDate, isDone, type Nav } from './lib';
import { useMatterLabel, useWF } from './store';
import { TaskDrawer } from './TaskDrawer';
import { TaskRow } from './TaskRow';
import { useOpeners } from './TasksPage';

export function OverviewPage({ navigate }: { navigate: Nav }) {
  const { matters, clients, tasks, milestones, billingByMatter, caps, meEmail, today, focusTask } = useWF();
  const label = useMatterLabel();
  const { openTask, openMatter } = useOpeners(navigate);
  const open = matters.filter((m) => m.status !== 'closed');
  const in14 = addDays(today, 14);
  const overdueTasks = tasks.filter((t) => !isDone(t) && t.dueDate && t.dueDate < today);
  const mine = tasks
    .filter(
      (t) => !isDone(t) && (t.assignee === meEmail || (t.status === 'In Review' && t.reviewedBy === meEmail)),
    )
    .sort(byTaskOrder);
  const upcoming = milestones
    .filter((m) => !m.done && m.dueDate <= in14)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const outstandingEls = open.filter(
    (m) => (billingByMatter.get(m.id)?.elStatus ?? 'Not Started') !== 'Fully Executed',
  ).length;
  const unpaid = open.filter((m) =>
    ['Invoiced', 'Partially Invoiced'].includes(billingByMatter.get(m.id)?.invoiceStatus ?? ''),
  ).length;

  const tiles = [
    {
      label: 'Open mandates',
      value: open.length,
      note: `Across ${clients.length} clients`,
      page: 'workflow/matters',
    },
    {
      label: 'Urgent mandates',
      value: open.filter((m) => m.status === 'urgent').length,
      note: 'Marked urgent',
      page: 'workflow/matters',
    },
    ...(caps.viewBilling
      ? [
          {
            label: 'Engagement letters outstanding',
            value: outstandingEls,
            note: 'Open mandates not fully executed',
            page: 'workflow/billing',
          },
          {
            label: 'Invoices awaiting payment',
            value: unpaid,
            note: 'Invoiced or partially invoiced',
            page: 'workflow/billing',
          },
        ]
      : []),
    {
      label: 'Overdue tasks',
      value: overdueTasks.length,
      note: 'Past their due date',
      page: 'workflow/tasks',
    },
    {
      label: 'My open tasks',
      value: mine.length,
      note: 'Assigned to me or awaiting my review',
      page: 'workflow/tasks',
    },
    {
      label: 'Deadlines in the next 14 days',
      value: upcoming.filter((m) => m.dueDate >= today).length,
      note: `${upcoming.filter((m) => m.dueDate < today).length} overdue`,
      page: 'workflow/calendar',
    },
  ];

  return (
    <div className="wf-stack">
      <div className="wf-tiles">
        {tiles.map((t) => (
          <button key={t.label} type="button" className="wf-tile" onClick={() => navigate(t.page)}>
            <span>{t.label}</span>
            <strong>{t.value}</strong>
            <small>{t.note}</small>
          </button>
        ))}
      </div>
      <div className="wf-split">
        <section className="card wf-section" aria-labelledby="wf-mine-h">
          <div className="wf-row wf-between">
            <h2 id="wf-mine-h">My tasks</h2>
            <button type="button" className="text-link" onClick={() => navigate('workflow/tasks')}>
              All tasks <ArrowUpRight size={14} />
            </button>
          </div>
          {mine.length ? (
            <ul className="wf-task-list">
              {mine.slice(0, 12).map((t) => (
                <TaskRow key={t.id} task={t} onOpen={openTask} onOpenMatter={openMatter} compact />
              ))}
            </ul>
          ) : (
            <p className="wf-empty-line">Nothing is assigned to you or awaiting your review.</p>
          )}
          {mine.length > 12 && <p className="wf-caption">And {mine.length - 12} more under Tasks.</p>}
        </section>
        <section className="card wf-section" aria-labelledby="wf-up-h">
          <div className="wf-row wf-between">
            <h2 id="wf-up-h">Upcoming deadlines</h2>
            <button type="button" className="text-link" onClick={() => navigate('workflow/calendar')}>
              All deadlines <ArrowUpRight size={14} />
            </button>
          </div>
          {upcoming.length ? (
            <ul className="wf-list">
              {upcoming.map((m) => (
                <li key={m.id} className="wf-list-row">
                  <strong className={'wf-date-block' + (m.dueDate < today ? ' wf-overdue' : '')}>
                    {formatDate(m.dueDate)}
                  </strong>
                  <div className="wf-grow">
                    <strong>{m.title}</strong>
                    <button
                      type="button"
                      className="wf-link wf-caption"
                      onClick={() => openMatter(m.matterId)}
                    >
                      {label(m.matterId)}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="wf-empty-line">No deadlines in the next 14 days.</p>
          )}
        </section>
      </div>
      <section className="card wf-section" aria-labelledby="wf-recent-act-h">
        <div className="wf-row wf-between">
          <h2 id="wf-recent-act-h">Recent activity</h2>
          <button type="button" className="text-link" onClick={() => navigate('workflow/activity')}>
            All activity <ArrowUpRight size={14} />
          </button>
        </div>
        <ActivityList filterModule="workflow" limit={15} paged={false} />
      </section>
      {focusTask && (
        <TaskDrawer taskId={focusTask} onClose={() => openTask(null)} onOpenMatter={openMatter} />
      )}
    </div>
  );
}
