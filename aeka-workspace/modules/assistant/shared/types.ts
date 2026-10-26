// Assistant module: a personal assistant for each member (chat with tools, to-dos, reminders, memory,
// a morning brief and an optional WhatsApp channel). Everything is private to the member.
// Times are milliseconds; recurrence is computed in India time (Asia/Kolkata, no daylight saving).

export type TodoStatus = 'open' | 'done';
export type TodoPriority = 'normal' | 'high';
export type TodoSource = 'manual' | 'chat' | 'whatsapp' | 'mail';
export interface Todo {
  id: string;
  title: string;
  details: string;
  status: TodoStatus;
  priority: TodoPriority;
  dueAt: number | null;
  source: TodoSource;
  sourceRef: string; // e.g. a mail item id
  taskId: string | null; // set when moved to a Workflow task
  createdAt: number;
  updatedAt: number;
  doneAt: number | null;
  revision: number;
}

export const REPEATS = ['once', 'daily', 'weekdays', 'weekly', 'monthly'] as const;
export type Repeat = (typeof REPEATS)[number];
export const REPEAT_LABELS: Record<Repeat, string> = {
  once: 'Once',
  daily: 'Every day',
  weekdays: 'Every weekday',
  weekly: 'Every week',
  monthly: 'Every month',
};
export interface Reminder {
  id: string;
  title: string;
  dueAt: number; // next occurrence
  repeat: Repeat;
  status: 'active' | 'paused' | 'done';
  lastFiredAt: number | null;
  createdAt: number;
  updatedAt: number;
  revision: number;
}

export const MEMORY_CATEGORIES = ['preference', 'style', 'person', 'client', 'general'] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];
export const MEMORY_LABELS: Record<MemoryCategory, string> = {
  preference: 'Preference',
  style: 'Writing style',
  person: 'Person',
  client: 'Client',
  general: 'General',
};
// What the member has told the assistant to remember. Used in chat and in email drafting (style).
export interface Memory {
  id: string;
  category: MemoryCategory;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  channel: 'web' | 'whatsapp';
  createdAt: number;
  updatedAt: number;
}
export interface ToolNote {
  name: string;
  ok: boolean;
  summary: string; // one line shown under the reply, e.g. "Created reminder: Call Rahul, 3 pm"
  ref?: string; // page link, e.g. "assistant/reminders" or "mail/inbox#<id>"
}
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'notice'; // notice: a system line (errors, limits)
  content: string;
  tools: ToolNote[]; // actions taken while producing this reply
  createdAt: number;
}

export interface BriefLine {
  text: string;
  link?: string; // page id, optionally "#id"
}
export interface Brief {
  date: string; // YYYY-MM-DD, India time
  generatedAt: number;
  sections: { title: string; lines: BriefLine[] }[];
}

export interface AlertSettings {
  reminders: boolean;
  brief: boolean;
  urgentMail: boolean;
  meetings: boolean;
}
export interface AssistantSettings {
  briefEnabled: boolean;
  briefTime: string; // HH:MM, India time
  meetingAlerts: boolean; // a notification 10 minutes before each meeting (Outlook calendar)
  whatsapp: {
    phone: string | null; // linked, verified number (digits only), shown masked
    alerts: AlertSettings; // what is also sent to WhatsApp
  };
}
export interface WhatsAppStatus {
  available: boolean; // the firm has configured WhatsApp
  businessNumber: string; // display number to message, if known
  linked: boolean;
  phoneMasked: string;
  replyWindowOpen: boolean; // free-form replies allowed (24 hours since the member last wrote)
}
