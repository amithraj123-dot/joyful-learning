// Agents module: action contract (POST /api/modules, module "agents"). Every action works on the
// caller's own agents, runs, approvals and lessons; templates are shared with the firm.
//
// A run is a bounded tool loop (at most 6 model calls and 12 tool calls): the assistant's tools on the
// member's own data (to-dos, reminders, memory, notes, mail, calendar, chats, Workflow tasks and
// deadlines; drafts are only prepared), plus agent tools: notify me, keep notes between runs, save a
// lesson, list mandates, and ask for approval to send an email draft or create a Workflow task.
// Content from mail, chats and notices is data, never instructions.
//
// Learning is automatic: lessons the agent saves, and lessons drawn (one AI call) from a poor rating, a
// comment, a rejected approval or a run with failed steps, are applied to later runs at once. The
// member sees every lesson and can remove it.
import type {
  Agent,
  AgentStatus,
  Approval,
  ApprovalStatus,
  Lesson,
  Plan,
  Run,
  Template,
  Trigger,
} from './types';

export interface AgentInput {
  name: string;
  instruction: string;
  trigger: Trigger;
  status: AgentStatus;
}

export interface AgentsActions {
  // Reads a plain-text command (one AI call) as an agent: name, instruction and trigger, to confirm.
  'command.plan': { payload: { command: string }; result: Plan };
  // Runs a command once, now, without saving an agent.
  'command.run': { payload: { command: string }; result: Run };

  'agents.list': { payload: Record<string, never>; result: { agents: Agent[]; pendingApprovals: number } };
  // lessons: the agent's own and those for every agent (agentId null), all that it follows.
  'agent.get': {
    payload: { id: string };
    result: { agent: Agent; runs: Run[]; lessons: Lesson[] };
  };
  // Creates (no id) or updates an agent. Updates take baseRevision.
  'agent.save': {
    payload: { id?: string; agent: AgentInput; baseRevision?: number };
    result: Agent;
  };
  'agent.run': { payload: { id: string }; result: Run };
  // Clears what the agent keeps between runs.
  'agent.clearNotes': { payload: { id: string }; result: Agent };
  'agent.delete': { payload: { id: string }; result: true };

  'runs.list': { payload: { agentId?: string; limit?: number }; result: Run[] };
  'run.get': { payload: { id: string }; result: { run: Run; approvals: Approval[] } };
  // Rating 1 (good) or -1 (poor), with an optional comment. A poor rating or a comment teaches the
  // agent: the lessons drawn from it are returned.
  'run.feedback': {
    payload: { id: string; rating: 1 | -1; comment?: string };
    result: { run: Run; lessons: Lesson[] };
  };

  'approvals.list': { payload: { status?: ApprovalStatus }; result: Approval[] };
  // Approving carries the action out as the member; rejecting (with an optional reason) teaches the agent.
  'approval.decide': {
    payload: { id: string; approve: boolean; reason?: string };
    result: { approval: Approval; lessons: Lesson[] };
  };

  // agentId: only that agent's lessons and those for every agent.
  'lessons.list': { payload: { agentId?: string }; result: Lesson[] };
  // A lesson written by the member (agentId null: for every agent).
  'lesson.save': { payload: { agentId: string | null; text: string }; result: Lesson };
  'lesson.delete': { payload: { id: string }; result: true };

  'templates.list': { payload: Record<string, never>; result: Template[] };
  // Partners and administrators publish one of their agents for the firm (without its notes or lessons).
  'template.publish': { payload: { agentId: string; description: string }; result: Template };
  // Copies a template as my own agent, paused until I switch it on.
  'template.copy': { payload: { id: string }; result: Agent };
  // The author, or an administrator.
  'template.delete': { payload: { id: string }; result: true };
}

export type AgentsAction = keyof AgentsActions;
