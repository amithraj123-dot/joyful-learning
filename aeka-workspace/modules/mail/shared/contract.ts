// Mail module: action contract (POST /api/modules, module "mail"). Every action works on the caller's
// own mailbox only; no member can read another member's mail, administrators included.
//
// Connecting: the browser opens GET /api/mail/connect (Microsoft sign-in, delegated permissions
// offline_access User.Read Mail.ReadWrite Mail.Send Calendars.Read); Microsoft returns to
// GET /api/mail/callback. The calendar is read only and cached for yesterday to 14 days ahead; it is
// used by the assistant through server/service.ts (calendarStatus, eventsBetween, freeTime).
//
// Triage pipeline (server, on 'sync' and on background ticks):
//   1. Delta sync of Inbox and Sent Items (deletions are recorded as removed, never as failures).
//   2. Built-in rules without AI: bulk mail (List-Unsubscribe, Precedence: bulk, Auto-Submitted),
//      no-reply senders and calendar responses become tier 4 / no action, source "rules".
//   3. The member's active rules apply next (source "rule"); neverAi senders are triaged by rules only.
//   4. Remaining mail goes to the AI in small batches (fast model), with the tier scale, categories,
//      handling values, the member's recent corrections as examples, and candidate mandates. Replies
//      are validated; an invalid item is retried at most 3 times with backoff, then marked failed.
//   5. Nothing is drafted automatically. Items with replyNeeded yes/maybe ask "Draft a reply?".
//
// Revisioned records (triage, drafts) take baseRevision and fail with 409 when changed elsewhere.
import type {
  AccountSettings,
  Address,
  Category,
  Draft,
  FollowUp,
  FollowUpKind,
  Handling,
  MailAccount,
  MailItem,
  MailMessage,
  MailRule,
  MailView,
  PersonKey,
  QueueCounts,
  RuleEffect,
  StyleProfile,
  Tier,
  Triage,
} from './types';

type Rev = { baseRevision: number };

export interface MailSetup {
  outlookConfigured: boolean; // MS_CLIENT_ID and MS_CLIENT_SECRET are set
  storageReady: boolean; // AEKA_ENCRYPTION_KEY is set
  aiReady: boolean; // the firm AI service is configured
  aiReason: string;
}

export interface TriageChanges {
  tier?: Tier;
  category?: Category;
  handling?: Handling;
  matterId?: string | null;
  delegate?: PersonKey | null;
}

export interface MailActions {
  'account.get': {
    payload: Record<string, never>;
    result: { account: MailAccount | null; setup: MailSetup };
  };
  'account.update': { payload: { settings: AccountSettings }; result: MailAccount };
  // Removes the stored token and this member's mail, triage, drafts, corrections and rules from the
  // workspace. Outlook itself is untouched.
  'account.disconnect': { payload: Record<string, never>; result: true };

  // Fetches new mail and triages a bounded batch now (at most 25 AI-triaged emails per call).
  sync: {
    payload: Record<string, never>;
    result: { fetched: number; triaged: number; pending: number; failed: number };
  };

  'inbox.list': {
    payload: { view: MailView; search?: string; before?: number; limit?: number }; // newest first
    result: { items: MailItem[]; counts: QueueCounts; nextBefore: number | null };
  };
  'message.get': { payload: { id: string }; result: MailMessage };

  // One-tap corrections. Each recorded correction teaches later triage (as examples); repeated
  // corrections for the same sender or domain propose a rule the member can accept.
  'triage.correct': { payload: { id: string; changes: TriageChanges } & Rev; result: Triage };
  'triage.retry': { payload: { id: string }; result: Triage }; // failed items: try the AI again
  // The answer to "Draft a reply?". Declining records the choice; it never calls the AI.
  'triage.decide': { payload: { id: string; wantDraft: boolean } & Rev; result: Triage };

  // Drafting (AI, strong model) only on request. Uses the email, its thread, the linked mandate's
  // facts and the member's style memory; missing facts become [INPUT REQUIRED: ...].
  'draft.create': {
    payload: { id: string; instructions?: string; replyAll?: boolean };
    result: Draft;
  };
  // Drafts not yet sent (draft, saved), newest first, with the email they reply to; includeSent adds
  // the 20 most recently sent.
  'drafts.list': {
    payload: { includeSent?: boolean };
    result: (Draft & { subject: string; from: Address; receivedAt: number })[];
  };
  'draft.get': { payload: { id: string }; result: Draft }; // draft id
  'draft.update': {
    payload: { draftId: string; body: string; to: Address[]; cc: Address[]; replyAll: boolean } & Rev;
    result: Draft;
  };
  // Creates or updates the reply in Outlook's Drafts folder (replying in the original thread).
  'draft.saveToOutlook': { payload: { draftId: string } & Rev; result: Draft };
  // Sends the reviewed draft from the member's mailbox. Refused while placeholders remain or when the
  // recipients are empty. `confirm` must be true (the browser asks first).
  'draft.send': { payload: { draftId: string; confirm: true } & Rev; result: Draft };
  'draft.discard': { payload: { draftId: string } & Rev; result: true };

  // Moves my emails to Outlook's Archive folder (and out of the triage views). At most 100 at a time.
  'message.archive': { payload: { ids: string[] }; result: { archived: number } };

  // Follow-ups (see FollowUp). Computed from stored mail; no AI.
  // includeClosed adds snoozed and done threads (most recent first after the open ones), to reopen them.
  'followups.list': { payload: { kind?: FollowUpKind; includeClosed?: boolean }; result: FollowUp[] };
  // Snooze a waiting thread (days 1 to 30), mark it done, or clear both.
  'followups.update': {
    payload: {
      conversationId: string;
      kind: FollowUpKind;
      action: 'snooze' | 'done' | 'reopen';
      days?: number;
    };
    result: true;
  };
  // A polite follow-up draft to the people I am waiting on (AI, on request); reviewed and sent like any
  // other draft.
  'followups.draftNudge': { payload: { conversationId: string; instructions?: string }; result: Draft };

  // Writing style: learn proposes a profile from up to 40 of my recent sent emails (one AI call).
  'style.get': { payload: Record<string, never>; result: StyleProfile | null };
  'style.learn': { payload: Record<string, never>; result: StyleProfile };
  'style.save': {
    payload: {
      profile: Pick<StyleProfile, 'greeting' | 'signOff' | 'tone' | 'notes'>;
      status: 'active' | 'rejected';
    };
    result: StyleProfile;
  };

  'rules.list': { payload: Record<string, never>; result: MailRule[] };
  'rules.save': {
    payload: {
      rule: {
        id?: string;
        kind: MailRule['kind'];
        pattern: string;
        effect: RuleEffect;
        status: MailRule['status'];
      };
    };
    result: MailRule;
  };
  'rules.delete': { payload: { id: string }; result: true };

  // Turns an email into a Workflow task on a mandate the member can see (task rules apply).
  'task.fromMail': {
    payload: {
      id: string;
      matterId: string;
      title: string;
      assignee: PersonKey | null;
      dueDate: string | null;
    };
    result: { taskId: string };
  };

  // Learning and cost review for the member: corrections by field over 30 days, AI calls today.
  stats: {
    payload: Record<string, never>;
    result: {
      triaged30d: number;
      corrected30d: number;
      correctionsByField: Record<string, number>;
      aiCallsToday: number;
      aiLimit: number;
    };
  };
}

export type MailAction = keyof MailActions;
