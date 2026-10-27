// Agents: automated workflows a member describes in plain words. An agent runs on command, on a
// schedule or when something happens in the workspace, uses the assistant's tools on the member's own
// data, prepares work freely, and asks before anything leaves the workspace or changes shared records.
// It keeps notes between runs and learns lessons from the member's ratings, comments and decisions.
// Shared by the server and the browser.

// Schedules repeat in India time. "once" runs at `at` only.
export const SCHEDULE_REPEATS = ['once', 'daily', 'weekdays', 'weekly', 'monthly'] as const;
export type ScheduleRepeat = (typeof SCHEDULE_REPEATS)[number];
export const REPEAT_LABELS: Record<ScheduleRepeat, string> = {
  once: 'Once',
  daily: 'Every day',
  weekdays: 'Every weekday',
  weekly: 'Every week',
  monthly: 'Every month',
};

// Things that can start an agent: workspace notices of these kinds (the same ones the phone shows).
export const EVENT_KINDS = [
  'mail.urgent',
  'mail.action',
  'chats.urgent',
  'chats.action',
  'task.assigned',
  'todo.due',
  'reminder',
  'meeting',
  'followup',
  'brief',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const EVENT_LABELS: Record<EventKind, string> = {
  'mail.urgent': 'An urgent email arrives',
  'mail.action': 'An important email needs my reply',
  'chats.urgent': 'An urgent chat arrives',
  'chats.action': 'A chat needs my reply',
  'task.assigned': 'A Workflow task is assigned to me',
  'todo.due': 'A to-do falls due',
  reminder: 'A reminder goes off',
  meeting: 'A meeting is about to start',
  followup: 'An email has gone unanswered for 10 days',
  brief: 'The morning brief is ready',
};

export type Trigger =
  | { type: 'manual' }
  | { type: 'schedule'; repeat: ScheduleRepeat; at: number } // `at`: the first (or only) run, ms
  | { type: 'event'; kinds: EventKind[]; contains: string }; // contains: '' or words the notice must contain

export type AgentStatus = 'active' | 'paused';

export interface Agent {
  id: string;
  name: string;
  instruction: string; // what to do, in the member's words (and the planner's tidy-up)
  trigger: Trigger;
  status: AgentStatus;
  notes: string; // what the agent keeps between runs, written by the agent itself
  templateId: string | null; // copied from a firm template
  nextRunAt: number | null; // schedules only
  lastRunAt: number | null;
  stats: { runs: number; good: number; bad: number; approved: number; rejected: number };
  monthlyLimit: number; // AI calls a month (0: no limit); runs stop when reached, until the 1st
  usedThisMonth: number; // AI calls this month (India time), its runs and what it learnt from them
  createdAt: number;
  updatedAt: number;
  revision: number;
}

export type RunStatus = 'running' | 'done' | 'failed';
export type RunTrigger = 'command' | 'manual' | 'schedule' | 'event';
export interface RunStep {
  tool: string;
  ok: boolean;
  summary: string; // what was done, or why not
  ref?: string; // page link, e.g. "assistant/todos#<id>"
}
export interface Run {
  id: string;
  agentId: string | null; // null for a one-off command
  agentName: string;
  trigger: RunTrigger;
  status: RunStatus;
  command: string; // the instruction this run followed
  summary: string; // the agent's report
  steps: RunStep[];
  error: string;
  rating: -1 | 0 | 1;
  feedback: string;
  startedAt: number;
  finishedAt: number | null;
}

// What waits for the member's one-tap approval.
export const APPROVAL_ACTIONS = ['send_email', 'create_task', 'update_task'] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'failed' | 'expired';
export interface Approval {
  id: string;
  agentId: string | null;
  agentName: string;
  runId: string;
  action: ApprovalAction;
  title: string; // e.g. "Send the email to rahul@vista.example: Re: Valuation note"
  detail: string; // the text to be sent, or the task details
  reason: string; // why the agent proposes it
  link: string; // where to review or edit it first, e.g. "mail/drafts"
  status: ApprovalStatus;
  result: string; // what happened after the decision
  createdAt: number;
  decidedAt: number | null;
}

export type LessonSource = 'agent' | 'feedback' | 'approval' | 'review' | 'member';
export interface Lesson {
  id: string;
  agentId: string | null; // null: applies to every agent
  text: string;
  source: LessonSource;
  uses: number; // runs that were given this lesson
  createdAt: number;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  instruction: string;
  trigger: Trigger;
  author: string; // member email
  authorName: string;
  copies: number;
  createdAt: number;
}

// The planner's reading of a plain-text command.
export interface Plan {
  name: string;
  instruction: string;
  trigger: Trigger;
  explanation: string; // one line: how Aeka read it, e.g. "Every Monday at 9:00 am, then ..."
}
