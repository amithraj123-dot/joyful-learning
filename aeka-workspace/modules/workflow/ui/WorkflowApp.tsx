'use client';
// Workflow module view: loads the snapshot, keeps it current and renders the selected page.
import { CircleUserRound, TriangleAlert } from 'lucide-react';
import type { ModuleViewProps } from '../../../core/client/module';
import { Empty } from './components/Bits';
import type { Nav } from './lib';
import { WorkflowProvider, type WorkflowStore } from './store';
import { ActivityPage } from './ActivityPage';
import { BillingPage } from './BillingPage';
import { DeadlinesPage } from './DeadlinesPage';
import { DealsPage } from './DealsPage';
import { MattersPage } from './MattersPage';
import { OverviewPage } from './OverviewPage';
import { TasksPage } from './TasksPage';
import { TeamPage } from './TeamPage';
import { TimePage } from './TimePage';
import './workflow.css';

function Body({ store, page, navigate }: { store: WorkflowStore; page: string; navigate: Nav }) {
  if (store.phase === 'loading')
    return (
      <p className="wf-loading" role="status">
        Loading the workflow
      </p>
    );
  if (store.phase === 'not-member')
    return (
      <Empty icon={CircleUserRound} title="Access has not been granted yet">
        You are signed in as <strong>{store.me?.email || 'an unknown account'}</strong>, which is not a member
        of the firm workspace. An administrator must add this email under Team and Access before you can see
        clients, mandates and tasks.
      </Empty>
    );
  if (store.phase === 'error' || !store.snap)
    return (
      <Empty
        icon={TriangleAlert}
        title="The workflow could not be loaded"
        action={
          <button type="button" className="button primary" onClick={store.retry}>
            Try again
          </button>
        }
      >
        {store.error || 'The workspace did not respond.'}
      </Empty>
    );
  switch (page) {
    case 'workflow/matters':
      return <MattersPage navigate={navigate} />;
    case 'workflow/tasks':
      return <TasksPage navigate={navigate} />;
    case 'workflow/calendar':
      return <DeadlinesPage navigate={navigate} />;
    case 'workflow/deals':
      return <DealsPage navigate={navigate} />;
    case 'workflow/billing':
      return <BillingPage navigate={navigate} />;
    case 'workflow/time':
      return <TimePage />;
    case 'workflow/team':
      return <TeamPage />;
    case 'workflow/activity':
      return <ActivityPage />;
    default:
      return <OverviewPage navigate={navigate} />;
  }
}

export default function WorkflowApp({ page, navigate, notify }: ModuleViewProps) {
  return (
    <WorkflowProvider notify={notify}>
      {(store) => (
        <div className="wf">
          <Body store={store} page={page} navigate={navigate} />
        </div>
      )}
    </WorkflowProvider>
  );
}
