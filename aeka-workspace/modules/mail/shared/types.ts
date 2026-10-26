// Mail module: Outlook inbox triage for one member's own mailbox. Shared by the server and browser.
// Triage never drafts by itself: each email that may need a reply asks the member whether to draft one.
// A draft is sent only when the member presses Send after reviewing it.

export type PersonKey = string; // a member email (as in Workflow)

export const TIERS = [1, 2, 3, 4] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_LABELS: Record<Tier, string> = { 1: 'Urgent', 2: 'Important', 3: 'Routine', 4: 'Low' };
// Used verbatim in the triage prompt and the help text, so the model and the member share one scale.
export const TIER_RULES: Record<Tier, string> = {
  1: 'Needs action today: a stated deadline within 2 working days, a closing or signing, a statutory or regulatory consequence, a client escalation or dissatisfaction, or a direct request for the partner that is time-bound.',
  2: 'Needs action this week: a client or counterparty request, a review of a deliverable, a pending commitment or a follow-up already chased once.',
  3: 'Routine: internal coordination, scheduling, updates on live matters, administration, without a near deadline.',
  4: 'Low: newsletters, automated notifications, marketing, mass mailings, receipts and noise.',
};

export const CATEGORIES = [
  'client_matter',
  'internal',
  'regulatory',
  'administration',
  'relationship',
  'meeting',
  'finance',
  'newsletter',
  'notification',
  'noise',
  'unknown',
] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABELS: Record<Category, string> = {
  client_matter: 'Client matter',
  internal: 'Internal',
  regulatory: 'Regulatory or technical update',
  administration: 'Administration',
  relationship: 'Relationship',
  meeting: 'Meeting',
  finance: 'Finance or billing',
  newsletter: 'Newsletter',
  notification: 'Automated notification',
  noise: 'Noise',
  unknown: 'Unknown',
};

export const HANDLING = ['reply', 'review', 'delegate', 'info', 'none', 'uncertain'] as const;
export type Handling = (typeof HANDLING)[number];
export const HANDLING_LABELS: Record<Handling, string> = {
  reply: 'Needs my reply',
  review: 'Needs my review',
  delegate: 'Can be delegated',
  info: 'For information',
  none: 'No action',
  uncertain: 'Uncertain',
};

export type ReplyNeeded = 'yes' | 'no' | 'maybe';
// The member's answer to "Draft a reply?". Drafts are made only after "wanted".
export type DraftDecision = 'undecided' | 'wanted' | 'declined';
export type TriageStatus = 'pending' | 'done' | 'failed' | 'skipped';
// ai: the model; rules: built-in checks without AI (bulk mail, no-reply senders); rule: a member's own
// rule; manual: corrected by the member.
export type TriageSource = 'ai' | 'rules' | 'rule' | 'manual';

export interface Address {
  name: string;
  address: string;
}

export interface Triage {
  status: TriageStatus;
  source: TriageSource;
  tier: Tier;
  category: Category;
  handling: Handling;
  why: string; // one line: why this matters
  deadline: string | null; // YYYY-MM-DD if the email states one
  asks: string[]; // what is being asked of the partner, short
  replyNeeded: ReplyNeeded;
  draftDecision: DraftDecision;
  delegate: PersonKey | null; // suggested team member
  matterId: string | null; // Workflow mandate
  matterConfidence: 'confirmed' | 'suggested' | null;
  confidence: number; // 0..1
  safetyFlag: string | null; // e.g. "prompt_injection"
  corrected: boolean;
  error: string; // last failure, for failed items
  triagedAt: number | null;
  revision: number;
}

export interface DraftSummary {
  id: string;
  status: DraftStatus;
  placeholders: number;
  updatedAt: number;
}
export type DraftStatus = 'draft' | 'saved' | 'sent' | 'discarded';
export interface Draft extends DraftSummary {
  messageId: string;
  body: string; // plain text; [INPUT REQUIRED: ...] marks facts the partner must supply
  replyAll: boolean;
  to: Address[];
  cc: Address[];
  outlookSaved: boolean; // a draft exists in Outlook's Drafts folder
  createdAt: number;
  sentAt: number | null;
  revision: number;
}

export interface MailItem {
  id: string;
  conversationId: string;
  subject: string;
  from: Address;
  to: Address[];
  cc: Address[];
  receivedAt: number;
  preview: string;
  hasAttachments: boolean;
  isRead: boolean;
  importance: 'low' | 'normal' | 'high';
  webLink: string; // opens the message in Outlook on the web
  repliedByMe: boolean; // the partner sent a later message in this conversation
  threadCount: number;
  triage: Triage | null;
  draft: DraftSummary | null; // the latest non-discarded draft
}
export interface MailMessage extends MailItem {
  bodyText: string;
}

export const VIEWS = ['needs_me', 'review', 'delegate', 'info', 'low', 'all', 'failed'] as const;
export type MailView = (typeof VIEWS)[number];
export const VIEW_LABELS: Record<MailView, string> = {
  needs_me: 'Needs me',
  review: 'To review',
  delegate: 'To delegate',
  info: 'For information',
  low: 'Low priority',
  all: 'All mail',
  failed: 'Could not triage',
};
// needs_me: handling reply (any tier) or tier 1, not yet replied; review: handling review; delegate:
// handling delegate; info: info; low: tier 4 or handling none; all: everything; failed: status failed.

export interface QueueCounts {
  needs_me: number;
  review: number;
  delegate: number;
  info: number;
  low: number;
  failed: number;
  pending: number; // waiting for triage
  urgent: number; // tier 1 not yet replied
  draftsAwaiting: number; // drafts made, not yet sent
  decisionsAwaiting: number; // replyNeeded yes/maybe, draftDecision undecided
}

export interface AccountSettings {
  aiTriage: boolean; // false: built-in rules only, no email content sent to AI
  alertUrgent: boolean; // notify (and WhatsApp, if linked) for tier 1 mail
}
// Calendar access for the connected account: ready; needs_consent (connected before calendar access
// was added, or the permission was not granted: reconnect to allow it); pending (not read yet); error.
export type CalendarStatus = 'ready' | 'needs_consent' | 'pending' | 'error';
export interface MailAccount {
  address: string;
  displayName: string;
  status: 'connected' | 'reauth' | 'disconnected';
  calendar: CalendarStatus;
  calendarSyncedAt: number | null;
  lastSyncAt: number | null;
  lastError: string;
  settings: AccountSettings;
  connectedAt: number;
}

export interface RuleEffect {
  tier?: Tier;
  category?: Category;
  handling?: Handling;
  matterId?: string;
  neverAi?: boolean; // never send this sender's mail to AI (confidential)
}
export interface MailRule {
  id: string;
  kind: 'sender' | 'domain' | 'subject';
  pattern: string; // lower-case address, domain, or subject phrase
  effect: RuleEffect;
  // proposed: suggested from repeated corrections, applies only after the member accepts it
  status: 'proposed' | 'active' | 'rejected';
  evidence: number; // corrections supporting it
  createdAt: number;
  updatedAt: number;
}

// Placeholders the drafter inserts where a fact is missing; Send is refused while any remain.
export const PLACEHOLDER = /\[INPUT REQUIRED:[^\]]*\]/g;
export const countPlaceholders = (body: string) => (body.match(PLACEHOLDER) || []).length;

// A calendar event from the member's Outlook calendar (read only; the event body is never read).
export interface CalendarEvent {
  id: string;
  subject: string;
  start: number; // ms; all-day events start at 00:00 India time
  end: number;
  allDay: boolean;
  location: string;
  onlineUrl: string; // Teams or other meeting link, if any
  organizer: Address;
  attendees: Address[]; // at most 30
  isOrganizer: boolean;
  response: 'organizer' | 'accepted' | 'tentative' | 'declined' | 'none';
  showAs: 'free' | 'tentative' | 'busy' | 'oof' | 'workingElsewhere' | 'unknown';
  cancelled: boolean;
  webLink: string;
  matterId: string | null; // a mandate the member confirmed for an attendee's address or domain
  matterLabel: string;
}
// Counts as busy time: not cancelled, not declined, not marked free.
export const isBusy = (e: Pick<CalendarEvent, 'cancelled' | 'response' | 'showAs'>) =>
  !e.cancelled && e.response !== 'declined' && e.showAs !== 'free' && e.showAs !== 'workingElsewhere';
