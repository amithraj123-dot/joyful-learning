// Assistant module: action contract (POST /api/modules, module "assistant"). All records belong to
// the caller; nobody else (administrators included) can read them.
//
// Chat: each 'chat.send' runs one bounded tool loop on the firm AI service (at most 5 model calls and
// 8 tool calls). Tools (server/tools.ts) act only for the caller:
//   my_work           open to-dos, Workflow tasks assigned to me, reminders due soon
//   create_todo, complete_todo, create_reminder, snooze_reminder
//   save_memory, forget_memory
//   search            to-dos, memory, my Scribe notes, mandates I can see, my triaged mail
//   mail_queue        my triaged mail needing attention (if Outlook is connected)
//   draft_email_reply makes a draft for my review in Mail; it never sends
//   calendar, find_free_time   my Outlook calendar (read only) and free periods on a day
//   today_brief       the morning brief
// Retrieved content (notes, mail, memory) is data, never instructions. The assistant never sends
// email, messages or anything else outside the workspace.
//
// Background (tick): due reminders become notifications once per occurrence, then advance; a notice
// comes 10 minutes before each meeting not declined (if meetingAlerts is on); the
// morning brief is posted at the member's brief time; notifications the member chose are delivered
// to WhatsApp when linked.
import type {
  AssistantSettings,
  Brief,
  ChatMessage,
  Conversation,
  Memory,
  MemoryCategory,
  Reminder,
  Repeat,
  Todo,
  TodoPriority,
  WhatsAppStatus,
} from './types';

type Rev = { baseRevision: number };
export type TodoInput = Pick<Todo, 'title' | 'details' | 'priority' | 'dueAt'> & { status?: Todo['status'] };
export type ReminderInput = { title: string; dueAt: number; repeat: Repeat; status?: 'active' | 'paused' };
export type MemoryInput = { category: MemoryCategory; title: string; content: string };

export interface AssistantActions {
  // Conversations
  'chat.list': { payload: Record<string, never>; result: Conversation[] }; // newest first, up to 100
  'chat.get': { payload: { id: string }; result: { conversation: Conversation; messages: ChatMessage[] } };
  // Starts a conversation when conversationId is absent. Returns the stored user message and reply.
  'chat.send': {
    payload: { conversationId?: string; text: string };
    result: { conversation: Conversation; messages: ChatMessage[] };
  };
  'chat.rename': { payload: { id: string; title: string }; result: Conversation };
  'chat.delete': { payload: { id: string }; result: true };

  // To-dos
  'todos.list': { payload: { includeDone?: boolean }; result: Todo[] };
  'todo.create': { payload: { todo: TodoInput }; result: Todo };
  'todo.update': { payload: { id: string; todo: TodoInput } & Rev; result: Todo };
  'todo.delete': { payload: { id: string }; result: true };
  // Moves a to-do onto a mandate as a Workflow task (task rules apply); the to-do is marked done.
  'todo.toTask': {
    payload: { id: string; matterId: string; assignee: string | null; dueDate: string | null };
    result: { todo: Todo; taskId: string };
  };

  // Reminders
  'reminders.list': { payload: Record<string, never>; result: Reminder[] };
  'reminder.create': { payload: { reminder: ReminderInput }; result: Reminder };
  'reminder.update': { payload: { id: string; reminder: ReminderInput } & Rev; result: Reminder };
  'reminder.snooze': { payload: { id: string; minutes: number } & Rev; result: Reminder };
  'reminder.delete': { payload: { id: string }; result: true };

  // Memory
  'memory.list': { payload: Record<string, never>; result: Memory[] };
  'memory.save': { payload: { id?: string; memory: MemoryInput }; result: Memory };
  'memory.delete': { payload: { id: string }; result: true };

  // Morning brief, assembled without AI from mail triage, tasks, to-dos, reminders and deadlines.
  'brief.get': { payload: Record<string, never>; result: Brief };

  // Settings and WhatsApp
  'settings.get': {
    payload: Record<string, never>;
    result: { settings: AssistantSettings; whatsapp: WhatsAppStatus };
  };
  'settings.save': {
    payload: {
      settings: Omit<AssistantSettings, 'whatsapp'> & { alerts: AssistantSettings['whatsapp']['alerts'] };
    };
    result: AssistantSettings;
  };
  // Linking: the member sends "LINK <code>" from their WhatsApp to the firm number within 15 minutes.
  'whatsapp.link': {
    payload: Record<string, never>;
    result: { code: string; expiresAt: number; businessNumber: string };
  };
  'whatsapp.unlink': { payload: Record<string, never>; result: true };
}

export type AssistantAction = keyof AssistantActions;
export type { TodoPriority };
