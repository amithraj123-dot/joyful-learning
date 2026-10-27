// Workflow: clients and mandates, tasks with maker-checker sign-off, deadlines, deal tracking,
// engagements and billing, timesheets, team access and the activity trail. Web only; the view is loaded
// lazily so the desktop (Scribe) bundle does not carry it.
import { lazy } from 'react';
import {
  Activity,
  BriefcaseBusiness,
  CalendarClock,
  Clock3,
  Handshake,
  LayoutDashboard,
  ListChecks,
  ReceiptIndianRupee,
  UsersRound,
} from 'lucide-react';
import type { ClientModule } from '../../core/client/module';

export const workflowModule: ClientModule = {
  id: 'workflow',
  name: 'Workflow',
  surfaces: ['web'],
  View: lazy(() => import('./ui/WorkflowApp')),
  // On an open Scribe note: link it to mandates.
  slots: { 'scribe.note': lazy(() => import('./ui/NoteMandateLink')) },
  pages: [
    {
      id: 'workflow/dashboard',
      label: 'Overview',
      icon: LayoutDashboard,
      title: 'Overview',
      subtitle: 'Open mandates, your tasks and the deadlines ahead',
    },
    {
      id: 'workflow/matters',
      label: 'Clients and mandates',
      icon: BriefcaseBusiness,
      title: 'Clients and Mandates',
      subtitle: 'Client portfolios, mandates, teams and their working files',
    },
    {
      id: 'workflow/tasks',
      label: 'Tasks',
      icon: ListChecks,
      title: 'Tasks',
      subtitle: 'Every deliverable by mandate or person, with preparer and reviewer sign-off',
    },
    {
      id: 'workflow/calendar',
      label: 'Deadlines',
      icon: CalendarClock,
      title: 'Deadlines',
      subtitle: 'Filings, signings and client meetings by month',
    },
    {
      id: 'workflow/deals',
      label: 'Deal tracker',
      icon: Handshake,
      title: 'Deal Tracker',
      subtitle: 'Target and counterparty documents through to execution',
    },
    {
      id: 'workflow/billing',
      label: 'Engagements and billing',
      icon: ReceiptIndianRupee,
      title: 'Engagements and Billing',
      subtitle: 'Engagement letters, fees, invoices and amounts outstanding',
    },
    {
      id: 'workflow/time',
      label: 'Timesheets',
      icon: Clock3,
      title: 'Timesheets',
      subtitle: 'Record time against mandates and export timesheets',
    },
    {
      id: 'workflow/team',
      label: 'Team and access',
      icon: UsersRound,
      title: 'Team and Access',
      subtitle: 'Firm members, designations and administrator rights',
    },
    {
      id: 'workflow/activity',
      label: 'Activity',
      icon: Activity,
      title: 'Activity',
      subtitle: 'Who changed what across the workflow, newest first',
    },
  ],
};
