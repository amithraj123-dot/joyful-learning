// Assistant module: a personal assistant for each member (chat with tools, to-dos, reminders, memory,
// a morning brief and an optional WhatsApp channel). Everything is private to the member.
// Times are milliseconds; recurrence is computed in India time (Asia/Kolkata, no daylight saving).

export type TodoStatus = 'open' | 'doing' | 'done';
export type TodoPriority = 'normal' | 'high';
// mail: an ask in an email; commitment: a promise in my sent mail; meeting: a Scribe action item.
// phone: a chat read from the member's phone (module chats).
export type TodoSource = 'manual' | 'chat' | 'whatsapp' | 'mail' | 'commitment' | 'meeting' | 'phone';
export const TODO_REPEATS = ['none', 'daily', 'weekly', 'fortnightly', 'monthly'] as const;
export type TodoRepeat = (typeof TODO_REPEATS)[number];
export interface Todo {
  id: string;
  title: string;
  details: string;
  status: TodoStatus;
  priority: TodoPriority;
  dueAt: number | null;
  source: TodoSource;
  sourceRef: string; // mail: "<mail item id>"; commitment: "<sent mail id>:<n>"; meeting: "<note id>:<action id>"
  sourceLabel: string; // e.g. the email subject or the meeting title, for the source badge
  list: string; // a list label, e.g. "Falcon"; '' for none
  repeat: TodoRepeat; // completing a repeating to-do creates the next one
  stale: boolean; // open for more than 7 days without a due date
  critical: boolean; // 3 or more days overdue
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

// Preparation for one meeting, assembled without AI (an AI summary is made only on request).
export interface MeetingPrepPerson {
  name: string;
  address: string;
  colleague: boolean; // a member of the firm
  lastMail: { mailId: string; subject: string; at: number } | null; // the latest email with them
  waitingOnThem: boolean;
  chasingMe: boolean;
}
export interface MeetingPrep {
  event: {
    id: string;
    subject: string;
    start: number;
    end: number;
    allDay: boolean;
    place: string; // location, or "Online"
    onlineUrl: string;
    webLink: string;
  };
  people: MeetingPrepPerson[]; // other attendees, external first, at most 15
  mandate: {
    matterId: string;
    label: string;
    openTasks: { title: string; dueDate: string | null; assignee: string | null }[];
    deadlines: { title: string; dueDate: string }[];
  } | null;
  recentMail: { mailId: string; subject: string; from: string; at: number; why: string }[]; // up to 8
  notes: { noteId: string; title: string; at: number; snippet: string }[]; // my Scribe notes about it
  todos: { id: string; title: string; dueAt: number | null }[]; // my open to-dos on the same list
  summary: { text: string; at: number } | null; // AI briefing, if made
}

// How full a day is. score 0 to 100 (higher is healthier): 100, minus 12 per meeting hour beyond 3,
// minus 15 per clash, minus 4 per back-to-back pair, plus up to 10 for the longest focus block (a full
// 10 at 3 hours), clamped. label: 80+ Light, 60+ Balanced, 40+ Heavy, below 40 Overloaded.
export interface DayHealth {
  date: string; // YYYY-MM-DD, India time
  meetings: number;
  meetingMinutes: number; // busy, timed meetings within 09:30 to 19:00
  focusMinutes: number; // free blocks of 60 minutes or more within 09:30 to 19:00
  longestFocus: number;
  clashes: number;
  backToBack: number; // pairs with less than 5 minutes between them
  score: number;
  label: 'Light' | 'Balanced' | 'Heavy' | 'Overloaded';
}
