// Chats module: messages from the member's phone (WhatsApp, WhatsApp Business, LinkedIn, Gmail, SMS,
// Teams and Slack), read from its notifications by the Aeka Android app and triaged here like email.
// Shared by the server and the browser. See docs/ANDROID-PROTOCOL.md for the phone side.

export const APPS = ['whatsapp', 'whatsapp_business', 'linkedin', 'gmail', 'sms', 'teams', 'slack'] as const;
export type AppId = (typeof APPS)[number];
export const APP_LABELS: Record<AppId, string> = {
  whatsapp: 'WhatsApp',
  whatsapp_business: 'WhatsApp Business',
  linkedin: 'LinkedIn',
  gmail: 'Gmail',
  sms: 'SMS',
  teams: 'Teams',
  slack: 'Slack',
};

export const TIERS = [1, 2, 3, 4] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_LABELS: Record<Tier, string> = { 1: 'Urgent', 2: 'Important', 3: 'Routine', 4: 'Low' };
// Used verbatim in the triage prompt and the help text.
export const TIER_RULES: Record<Tier, string> = {
  1: 'Needs a reply today: a client, counterparty or senior colleague asking for something time-bound, a closing or filing, an escalation, or a missed call from someone who matters with an urgent message.',
  2: 'Needs a reply soon: a direct question or request from a client, colleague or business contact, a follow-up already sent once, or a missed call from a known contact.',
  3: 'Routine: updates, coordination, scheduling, social messages and group discussion that do not ask anything of the member directly.',
  4: 'Low: promotions, automated messages, delivery and bank alerts, broadcast lists, newsletters and noise.',
};

export const CATEGORIES = [
  'client',
  'colleague',
  'business',
  'personal',
  'group',
  'automated',
  'promotional',
  'unknown',
] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABELS: Record<Category, string> = {
  client: 'Client or counterparty',
  colleague: 'Colleague',
  business: 'Business contact',
  personal: 'Personal',
  group: 'Group discussion',
  automated: 'Automated',
  promotional: 'Promotional',
  unknown: 'Unknown',
};

export type ReplyNeeded = 'yes' | 'no' | 'maybe';
// ai: the model; rules: built-in checks without AI; manual: set by the member.
export type TriageSource = 'ai' | 'rules' | 'manual';
export type TriageStatus = 'none' | 'pending' | 'done' | 'failed' | 'skipped';

export interface ChatTriage {
  status: TriageStatus;
  source: TriageSource;
  tier: Tier;
  category: Category;
  replyNeeded: ReplyNeeded;
  summary: string; // one line: what they want
  why: string; // one line: why this tier
  replyBy: string | null; // YYYY-MM-DD when a date is stated or implied
}

// needs: waiting for my reply; waiting: I replied last; all: everything recent; low: tier 4 and no reply
// needed; muted: chats I muted.
export const VIEWS = ['needs', 'waiting', 'all', 'low', 'muted'] as const;
export type ChatView = (typeof VIEWS)[number];

export interface ChatThread {
  id: string;
  app: AppId;
  chat: string; // the phone's chat key, e.g. "whatsapp:919812345678@s.whatsapp.net"
  title: string; // contact or group name
  group: boolean;
  address: string; // phone digits when known, e.g. "919812345678"
  lastIn: { at: number; sender: string; text: string } | null;
  lastOutAt: number | null; // my last reply (from Aeka, from the notification, or marked replied)
  waitingSince: number | null; // first message after my last reply, while I have not replied
  unanswered: number; // messages since my last reply
  seenAt: number | null; // I opened or read it on the phone
  snoozedUntil: number | null;
  done: boolean; // marked done for the current messages (a new message reopens it)
  muted: boolean; // never triaged or nudged
  neverAi: boolean; // triaged by rules only; never sent to AI, never drafted by AI
  vip: boolean;
  needsMe: boolean; // reply needed (yes or maybe), not answered, not done, not snoozed, not muted
  live: boolean; // the phone can send a reply through this chat's notification right now
  triage: ChatTriage | null;
  nudges: number; // nudges sent for the current wait
  updatedAt: number;
  revision: number;
}

export interface ChatMessage {
  id: string;
  sender: string;
  fromMe: boolean;
  text: string;
  at: number;
}

export type DraftStatus = 'draft' | 'sent' | 'discarded';
export interface ChatDraft {
  id: string;
  threadId: string;
  text: string;
  status: DraftStatus;
  how: 'notification' | 'manual' | null; // how it was sent
  createdAt: number;
  updatedAt: number;
  sentAt: number | null;
  revision: number;
}

// What the phone shows as notifications. Every workspace notice belongs to one of these kinds.
export const ALERTS = ['actions', 'chats', 'todos', 'reminders', 'tasks', 'meetings', 'brief'] as const;
export type AlertKind = (typeof ALERTS)[number];
export const ALERT_LABELS: Record<AlertKind, string> = {
  actions: 'New action needed: urgent or important mail and chats that need your reply',
  chats: 'Reminders to reply to chats',
  todos: 'To-dos when they fall due, and overdue ones',
  reminders: 'Reminders',
  tasks: 'Workflow tasks assigned to you',
  meetings: 'Meetings about to start',
  brief: 'The morning brief',
};

export interface ChatSettings {
  apps: Record<AppId, boolean>; // read on the phone
  alerts: Record<AlertKind, boolean>; // shown on the phone
  nudges: boolean; // reminders to reply
  quietHours: boolean; // no nudges from 10 pm to 7:30 am India time (urgent ones excepted)
  ai: boolean; // AI triage; when off, rules only
}
export const DEFAULT_SETTINGS: ChatSettings = {
  apps: {
    whatsapp: true,
    whatsapp_business: true,
    linkedin: true,
    gmail: true,
    sms: true,
    teams: true,
    slack: true,
  },
  alerts: {
    actions: true,
    chats: true,
    todos: true,
    reminders: true,
    tasks: true,
    meetings: true,
    brief: true,
  },
  nudges: true,
  quietHours: true,
  ai: true,
};

export interface PhoneDevice {
  id: string;
  name: string;
  model: string;
  appVersion: string;
  android: number;
  createdAt: number;
  lastSeenAt: number | null;
  access: { notifications: boolean; postNotifications: boolean; batteryUnrestricted: boolean } | null;
}

export interface QueueCounts {
  needs: number;
  waiting: number;
  low: number;
  pending: number; // waiting for triage
}
