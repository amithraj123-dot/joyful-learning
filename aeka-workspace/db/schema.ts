import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const workspaceNotes = sqliteTable(
  'workspace_notes',
  {
    owner: text('owner').notNull(),
    id: text('id').notNull(),
    value: text('value').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.owner, table.id] })],
);

export const workspaceDeleted = sqliteTable(
  'workspace_deleted',
  { owner: text('owner').notNull(), id: text('id').notNull(), updatedAt: integer('updated_at').notNull() },
  (t) => [primaryKey({ columns: [t.owner, t.id] })],
);
export const workspacePolicy = sqliteTable('workspace_policy', {
  owner: text('owner').primaryKey(),
  value: text('value').notNull(),
});
export const workspaceGrants = sqliteTable(
  'workspace_grants',
  {
    owner: text('owner').notNull(),
    kind: text('kind').notNull(),
    target: text('target').notNull(),
    email: text('email').notNull(),
    role: text('role').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.owner, t.kind, t.target, t.email] })],
);
export const workspaceComments = sqliteTable(
  'workspace_comments',
  {
    id: text('id').notNull(),
    owner: text('owner').notNull(),
    noteId: text('note_id').notNull(),
    author: text('author').notNull(),
    email: text('email').notNull(),
    text: text('text').notNull(),
    at: integer('at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.owner, t.noteId, t.id] })],
);
export const workspaceAudit = sqliteTable('workspace_audit', {
  id: text('id').primaryKey(),
  owner: text('owner').notNull(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  target: text('target').notNull(),
  at: integer('at').notNull(),
});
export const workspaceResources = sqliteTable('workspace_resources', {
  owner: text('owner').primaryKey(),
  value: text('value').notNull(),
  revision: integer('revision').notNull(),
});

export const workspaceStudio = sqliteTable('workspace_studio', {
  owner: text('owner').primaryKey(),
  value: text('value').notNull(),
  revision: integer('revision').notNull(),
});

// Last time each owner's retention purge ran, so it runs at most every few minutes.
export const workspaceMaintenance = sqliteTable('workspace_maintenance', {
  owner: text('owner').primaryKey(),
  retentionAt: integer('retention_at').notNull(),
});

// Core: firm members of the shared workspace (see core/server/members.ts).
export const orgMembers = sqliteTable('org_members', {
  email: text('email').primaryKey(),
  name: text('name').notNull(),
  initials: text('initials').notNull(),
  designation: text('designation').notNull(),
  isAdmin: integer('is_admin').notNull(),
  active: integer('active').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
// Core: activity trail written by every team module (see core/server/activity.ts).
export const orgActivity = sqliteTable(
  'org_activity',
  {
    id: text('id').primaryKey(),
    at: integer('at').notNull(),
    actor: text('actor').notNull(),
    actorName: text('actor_name').notNull(),
    module: text('module').notNull(),
    action: text('action').notNull(),
    target: text('target').notNull(),
    summary: text('summary').notNull(),
  },
  (t) => [index('org_activity_at').on(t.at), index('org_activity_target').on(t.target)],
);

// Workflow module (see modules/workflow/server). People are person keys: a member email or "legacy:XX".
// Arrays are JSON text; money is integer paise; dates are YYYY-MM-DD India dates.
export const wfClients = sqliteTable('wf_clients', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  notes: text('notes').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  revision: integer('revision').notNull(),
  deletedAt: integer('deleted_at'),
});
export const wfMatters = sqliteTable(
  'wf_matters',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull(),
    title: text('title').notNull(),
    type: text('type').notNull(),
    status: text('status').notNull(),
    stage: text('stage').notNull(),
    priority: integer('priority').notNull(),
    note: text('note').notNull(),
    team: text('team').notNull(),
    restricted: integer('restricted').notNull(),
    peerFeedbackVisible: integer('peer_feedback_visible').notNull(),
    isDeal: integer('is_deal').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    revision: integer('revision').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [index('wf_matters_client').on(t.clientId)],
);
export const wfBilling = sqliteTable('wf_billing', {
  matterId: text('matter_id').primaryKey(),
  elStatus: text('el_status').notNull(),
  invoiceStatus: text('invoice_status').notNull(),
  feePaise: integer('fee_paise'),
  adminNotes: text('admin_notes').notNull(),
  revision: integer('revision').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
export const wfInvoices = sqliteTable(
  'wf_invoices',
  {
    id: text('id').primaryKey(),
    matterId: text('matter_id').notNull(),
    invoiceNo: text('invoice_no').notNull(),
    date: text('date').notNull(),
    amountPaise: integer('amount_paise').notNull(),
    entity: text('entity').notNull(),
    notes: text('notes').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('wf_invoices_matter').on(t.matterId)],
);
export const wfTasks = sqliteTable(
  'wf_tasks',
  {
    id: text('id').primaryKey(),
    matterId: text('matter_id').notNull(),
    title: text('title').notNull(),
    status: text('status').notNull(),
    assignee: text('assignee'),
    preparedBy: text('prepared_by'),
    reviewedBy: text('reviewed_by'),
    reviewedAt: integer('reviewed_at'),
    dueDate: text('due_date'),
    priority: integer('priority').notNull(),
    notes: text('notes').notNull(),
    steps: text('steps').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    revision: integer('revision').notNull(),
    deletedAt: integer('deleted_at'),
  },
  (t) => [index('wf_tasks_matter').on(t.matterId)],
);
export const wfTime = sqliteTable(
  'wf_time',
  {
    id: text('id').primaryKey(),
    matterId: text('matter_id').notNull(),
    person: text('person').notNull(),
    date: text('date').notNull(),
    minutes: integer('minutes').notNull(),
    description: text('description').notNull(),
    billable: integer('billable').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('wf_time_person_date').on(t.person, t.date),
    index('wf_time_date').on(t.date),
    index('wf_time_matter').on(t.matterId),
  ],
);
export const wfMilestones = sqliteTable(
  'wf_milestones',
  {
    id: text('id').primaryKey(),
    matterId: text('matter_id').notNull(),
    title: text('title').notNull(),
    kind: text('kind').notNull(),
    dueDate: text('due_date').notNull(),
    done: integer('done').notNull(),
    owner: text('owner'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    revision: integer('revision').notNull(),
  },
  (t) => [index('wf_milestones_matter').on(t.matterId)],
);
export const wfDeals = sqliteTable('wf_deals', {
  matterId: text('matter_id').primaryKey(),
  dealValue: text('deal_value').notNull(),
  representing: text('representing').notNull(),
  targetCompany: text('target_company').notNull(),
  targetDocs: text('target_docs').notNull(),
  counterparties: text('counterparties').notNull(),
  revision: integer('revision').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
export const wfFeedback = sqliteTable(
  'wf_feedback',
  {
    id: text('id').primaryKey(),
    matterId: text('matter_id').notNull(),
    member: text('member').notNull(),
    kind: text('kind').notNull(),
    text: text('text').notNull(),
    rating: integer('rating'),
    author: text('author').notNull(),
    updatedAt: integer('updated_at').notNull(),
    revision: integer('revision').notNull(),
  },
  (t) => [uniqueIndex('wf_feedback_member').on(t.matterId, t.member, t.kind)],
);
// Scribe meeting notes linked to mandates: a copy shared by the note's owner (see MeetingLink).
// owner_user is the owner's sign-in id, which keys their notes; it is never sent to browsers.
export const wfMeetingLinks = sqliteTable(
  'wf_meeting_links',
  {
    id: text('id').primaryKey(),
    matterId: text('matter_id').notNull(),
    ownerUser: text('owner_user').notNull(),
    noteId: text('note_id').notNull(),
    title: text('title').notNull(),
    meetingAt: integer('meeting_at').notNull(),
    attendees: text('attendees').notNull(),
    summary: text('summary').notNull(),
    actions: text('actions').notNull(),
    includeTranscript: integer('include_transcript').notNull(),
    transcriptChars: integer('transcript_chars').notNull(),
    linkedBy: text('linked_by').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    revision: integer('revision').notNull(),
  },
  (t) => [
    uniqueIndex('wf_meeting_links_note').on(t.matterId, t.ownerUser, t.noteId),
    index('wf_meeting_links_owner').on(t.ownerUser, t.noteId),
  ],
);
// The shared transcript of a meeting link, kept apart so listing links does not read it.
export const wfMeetingTranscripts = sqliteTable('wf_meeting_transcripts', {
  linkId: text('link_id').primaryKey(),
  transcript: text('transcript').notNull(),
});
// One row, key "version": bumped on every workflow write (including deletes) so clients can poll cheaply.
export const wfMeta = sqliteTable('wf_meta', {
  key: text('key').primaryKey(),
  value: integer('value').notNull(),
});

// Core: notifications for members from any module (dedupe_key makes a notice idempotent).
export const orgNotifications = sqliteTable(
  'org_notifications',
  {
    id: text('id').primaryKey(),
    recipient: text('recipient').notNull(),
    module: text('module').notNull(),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    link: text('link').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    createdAt: integer('created_at').notNull(),
    readAt: integer('read_at'),
    // Channels this notice was delivered to, e.g. "whatsapp" (comma separated).
    delivered: text('delivered').notNull().default(''),
  },
  (t) => [
    uniqueIndex('org_notifications_dedupe').on(t.recipient, t.dedupeKey),
    index('org_notifications_recipient').on(t.recipient, t.createdAt),
  ],
);
// Core: every AI call, successful or not, for limits and cost review.
export const aiUsage = sqliteTable(
  'ai_usage',
  {
    id: text('id').primaryKey(),
    at: integer('at').notNull(),
    actor: text('actor').notNull(),
    module: text('module').notNull(),
    purpose: text('purpose').notNull(),
    model: text('model').notNull(),
    ok: integer('ok').notNull(),
    promptTokens: integer('prompt_tokens').notNull(),
    completionTokens: integer('completion_tokens').notNull(),
    error: text('error').notNull(),
  },
  (t) => [index('ai_usage_actor_at').on(t.actor, t.at)],
);
// Core: short leases so background jobs never overlap.
export const coreLeases = sqliteTable('core_leases', {
  name: text('name').primaryKey(),
  until: integer('until').notNull(),
});

// Mail: one Outlook account per member; the token is sealed (core/server/secrets.ts).
export const mailAccounts = sqliteTable('mail_accounts', {
  member: text('member').primaryKey(),
  address: text('address').notNull(),
  displayName: text('display_name').notNull(),
  tokenSealed: text('token_sealed').notNull(),
  accessExpires: integer('access_expires').notNull(),
  status: text('status').notNull(), // connected | reauth | disconnected
  inboxDelta: text('inbox_delta'),
  sentDelta: text('sent_delta'),
  lastSyncAt: integer('last_sync_at'),
  lastError: text('last_error').notNull().default(''),
  settings: text('settings').notNull(), // JSON: aiTriage, alertUrgent
  calendarStatus: text('calendar_status').notNull().default('pending'),
  calendarSyncedAt: integer('calendar_synced_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
// Mail: a cached window of the member's Outlook calendar (yesterday to 14 days ahead), replaced on
// each refresh. Read only; event bodies are never fetched.
export const mailEvents = sqliteTable(
  'mail_events',
  {
    member: text('member').notNull(),
    id: text('id').notNull(),
    subject: text('subject').notNull(),
    startAt: integer('start_at').notNull(),
    endAt: integer('end_at').notNull(),
    allDay: integer('all_day').notNull(),
    location: text('location').notNull(),
    onlineUrl: text('online_url').notNull(),
    organizerJson: text('organizer_json').notNull(),
    attendeesJson: text('attendees_json').notNull(),
    isOrganizer: integer('is_organizer').notNull(),
    response: text('response').notNull(),
    showAs: text('show_as').notNull(),
    cancelled: integer('cancelled').notNull(),
    webLink: text('web_link').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.member, t.id] }), index('mail_events_start').on(t.member, t.startAt)],
);
// Mail: per-conversation follow-up state set by the member (snoozed or done).
export const mailThreads = sqliteTable(
  'mail_threads',
  {
    member: text('member').notNull(),
    conversationId: text('conversation_id').notNull(),
    waitingSnoozedUntil: integer('waiting_snoozed_until'),
    waitingDone: integer('waiting_done').notNull().default(0), // when marked done (ms); 0: not done
    chasingDone: integer('chasing_done').notNull().default(0), // when marked done (ms); 0: not done
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.member, t.conversationId] })],
);
// Mail: the member's writing style, learned from their sent mail (proposed until they accept it).
export const mailStyle = sqliteTable('mail_style', {
  member: text('member').primaryKey(),
  profile: text('profile').notNull(), // JSON StyleProfile
  status: text('status').notNull(), // proposed | active | rejected
  sampleCount: integer('sample_count').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
// Mail: pending OAuth sign-ins (PKCE verifier sealed), kept for ten minutes.
export const mailOauthStates = sqliteTable('mail_oauth_states', {
  state: text('state').primaryKey(),
  member: text('member').notNull(),
  verifierSealed: text('verifier_sealed').notNull(),
  createdAt: integer('created_at').notNull(),
});
export const mailMessages = sqliteTable(
  'mail_messages',
  {
    id: text('id').primaryKey(),
    member: text('member').notNull(),
    graphId: text('graph_id').notNull(),
    internetMessageId: text('internet_message_id').notNull(),
    conversationId: text('conversation_id').notNull(),
    folder: text('folder').notNull(), // inbox | sent
    subject: text('subject').notNull(),
    fromAddress: text('from_address').notNull(),
    fromName: text('from_name').notNull(),
    toJson: text('to_json').notNull(),
    ccJson: text('cc_json').notNull(),
    receivedAt: integer('received_at').notNull(),
    preview: text('preview').notNull(),
    bodyText: text('body_text').notNull(), // plain text, quoted history removed, capped
    hasAttachments: integer('has_attachments').notNull(),
    importance: text('importance').notNull(),
    isRead: integer('is_read').notNull(),
    bulk: integer('bulk').notNull(), // List-Unsubscribe / Precedence: bulk / Auto-Submitted
    // Sent mail: when commitments were looked for (null: not yet).
    commitmentsAt: integer('commitments_at'),
    // Meeting invitations: the proposed meeting time, to check against the calendar.
    meetingStart: integer('meeting_start'),
    meetingEnd: integer('meeting_end'),
    webLink: text('web_link').notNull(),
    removedAt: integer('removed_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('mail_messages_graph').on(t.member, t.graphId),
    index('mail_messages_received').on(t.member, t.folder, t.receivedAt),
    index('mail_messages_conversation').on(t.member, t.conversationId),
  ],
);
export const mailTriage = sqliteTable(
  'mail_triage',
  {
    messageId: text('message_id').primaryKey(),
    member: text('member').notNull(),
    status: text('status').notNull(), // pending | done | failed | skipped
    attempts: integer('attempts').notNull(),
    nextAttemptAt: integer('next_attempt_at').notNull(),
    source: text('source').notNull(), // ai | rules | rule | manual
    tier: integer('tier').notNull(),
    category: text('category').notNull(),
    handling: text('handling').notNull(),
    why: text('why').notNull(),
    deadline: text('deadline'),
    asks: text('asks').notNull(),
    replyNeeded: text('reply_needed').notNull(),
    draftDecision: text('draft_decision').notNull(),
    delegate: text('delegate'),
    matterId: text('matter_id'),
    matterConfidence: text('matter_confidence'),
    confidence: real('confidence').notNull(),
    safetyFlag: text('safety_flag'),
    corrected: integer('corrected').notNull(),
    model: text('model').notNull(),
    error: text('error').notNull(),
    triagedAt: integer('triaged_at'),
    updatedAt: integer('updated_at').notNull(),
    revision: integer('revision').notNull(),
  },
  (t) => [
    index('mail_triage_queue').on(t.member, t.status, t.handling, t.tier),
    index('mail_triage_due').on(t.status, t.nextAttemptAt),
  ],
);
export const mailCorrections = sqliteTable(
  'mail_corrections',
  {
    id: text('id').primaryKey(),
    member: text('member').notNull(),
    messageId: text('message_id').notNull(),
    field: text('field').notNull(),
    fromValue: text('from_value').notNull(),
    toValue: text('to_value').notNull(),
    sender: text('sender').notNull(),
    domain: text('domain').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('mail_corrections_member').on(t.member, t.createdAt),
    index('mail_corrections_sender').on(t.member, t.sender),
  ],
);
export const mailRules = sqliteTable(
  'mail_rules',
  {
    id: text('id').primaryKey(),
    member: text('member').notNull(),
    kind: text('kind').notNull(), // sender | domain | subject
    pattern: text('pattern').notNull(),
    effect: text('effect').notNull(), // JSON
    status: text('status').notNull(), // proposed | active | rejected
    evidence: integer('evidence').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [uniqueIndex('mail_rules_pattern').on(t.member, t.kind, t.pattern)],
);
export const mailDrafts = sqliteTable(
  'mail_drafts',
  {
    id: text('id').primaryKey(),
    member: text('member').notNull(),
    messageId: text('message_id').notNull(),
    graphDraftId: text('graph_draft_id'),
    body: text('body').notNull(),
    replyAll: integer('reply_all').notNull(),
    toJson: text('to_json').notNull(),
    ccJson: text('cc_json').notNull(),
    status: text('status').notNull(), // draft | saved | sent | discarded
    placeholders: integer('placeholders').notNull(),
    model: text('model').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    sentAt: integer('sent_at'),
    revision: integer('revision').notNull(),
  },
  (t) => [index('mail_drafts_message').on(t.member, t.messageId)],
);

// Assistant: personal to-dos, reminders, memory, conversations, settings and WhatsApp delivery.
export const asTodos = sqliteTable(
  'as_todos',
  {
    id: text('id').primaryKey(),
    member: text('member').notNull(),
    title: text('title').notNull(),
    details: text('details').notNull(),
    status: text('status').notNull(),
    priority: text('priority').notNull(),
    dueAt: integer('due_at'),
    source: text('source').notNull(),
    sourceRef: text('source_ref').notNull(),
    taskId: text('task_id'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    doneAt: integer('done_at'),
    revision: integer('revision').notNull(),
    list: text('list').notNull().default(''), // a list label, e.g. "Falcon" from "#Falcon"
    sourceLabel: text('source_label').notNull().default(''), // e.g. the email subject
    repeat: text('repeat').notNull().default('none'), // none | daily | weekly | fortnightly | monthly
    repeatDay: integer('repeat_day').notNull().default(0), // day of the month a monthly to-do keeps to
  },
  (t) => [
    index('as_todos_member').on(t.member, t.status, t.dueAt),
    // One to-do per source item (an email ask, a commitment, a meeting action item).
    uniqueIndex('as_todos_source')
      .on(t.member, t.source, t.sourceRef)
      .where(sql`source_ref != ''`),
  ],
);
// Meeting preparation summaries made by AI on request, kept per meeting occurrence.
export const asMeetingPreps = sqliteTable(
  'as_meeting_preps',
  {
    member: text('member').notNull(),
    eventId: text('event_id').notNull(),
    eventStart: integer('event_start').notNull(),
    summary: text('summary').notNull(),
    model: text('model').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.member, t.eventId, t.eventStart] })],
);
export const asReminders = sqliteTable(
  'as_reminders',
  {
    id: text('id').primaryKey(),
    member: text('member').notNull(),
    title: text('title').notNull(),
    dueAt: integer('due_at').notNull(),
    repeat: text('repeat').notNull(),
    status: text('status').notNull(),
    lastFiredAt: integer('last_fired_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    revision: integer('revision').notNull(),
  },
  (t) => [index('as_reminders_due').on(t.status, t.dueAt), index('as_reminders_member').on(t.member)],
);
export const asMemory = sqliteTable(
  'as_memory',
  {
    id: text('id').primaryKey(),
    member: text('member').notNull(),
    category: text('category').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('as_memory_member').on(t.member, t.updatedAt)],
);
export const asConversations = sqliteTable(
  'as_conversations',
  {
    id: text('id').primaryKey(),
    member: text('member').notNull(),
    title: text('title').notNull(),
    channel: text('channel').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('as_conversations_member').on(t.member, t.updatedAt)],
);
export const asMessages = sqliteTable(
  'as_messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id').notNull(),
    member: text('member').notNull(),
    seq: integer('seq').notNull(),
    role: text('role').notNull(),
    content: text('content').notNull(),
    tool: text('tool'), // JSON {name, ok, summary, ref}
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('as_messages_seq').on(t.conversationId, t.seq)],
);
export const asSettings = sqliteTable(
  'as_settings',
  {
    member: text('member').primaryKey(),
    settings: text('settings').notNull(), // JSON: brief, alerts
    whatsappPhone: text('whatsapp_phone'), // digits only, verified
    linkCode: text('link_code'),
    linkExpires: integer('link_expires'),
    lastInboundAt: integer('last_inbound_at'), // opens the 24-hour reply window
    lastBriefDate: text('last_brief_date'),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [uniqueIndex('as_settings_phone').on(t.whatsappPhone)],
);
export const asWhatsappEvents = sqliteTable('as_whatsapp_events', {
  id: text('id').primaryKey(), // provider message id, for duplicate suppression
  member: text('member'),
  body: text('body').notNull(), // inbound text, kept until processed
  status: text('status').notNull(), // queued | done | ignored | failed
  createdAt: integer('created_at').notNull(),
});
export const asOutbox = sqliteTable(
  'as_outbox',
  {
    id: text('id').primaryKey(),
    member: text('member').notNull(),
    phone: text('phone').notNull(),
    body: text('body').notNull(),
    status: text('status').notNull(), // queued | sending | sent | delivered | read | failed | uncertain
    providerId: text('provider_id'),
    error: text('error').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('as_outbox_status').on(t.status, t.createdAt), index('as_outbox_provider').on(t.providerId)],
);

// ---------- Chats: messages read from the member's phone notifications (Aeka for Android) ----------

// Phones connected with a pairing code. The device token is stored only as a SHA-256 hash.
export const chDevices = sqliteTable(
  'ch_devices',
  {
    id: text('id').primaryKey(),
    member: text('member').notNull(),
    name: text('name').notNull(),
    model: text('model').notNull(),
    appVersion: text('app_version').notNull(),
    android: integer('android').notNull(),
    secretHash: text('secret_hash').notNull(),
    accessJson: text('access_json').notNull().default(''), // notification access, battery, as last reported
    createdAt: integer('created_at').notNull(),
    lastSeenAt: integer('last_seen_at'),
    revokedAt: integer('revoked_at'),
  },
  (t) => [index('ch_devices_member').on(t.member)],
);
// One-time pairing codes (hash only), valid 10 minutes.
export const chPairings = sqliteTable('ch_pairings', {
  codeHash: text('code_hash').primaryKey(),
  member: text('member').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
  usedAt: integer('used_at'),
});
// One row per chat (an app's conversation), with its triage and reply state.
export const chThreads = sqliteTable(
  'ch_threads',
  {
    id: text('id').primaryKey(),
    member: text('member').notNull(),
    app: text('app').notNull(),
    chatKey: text('chat_key').notNull(),
    title: text('title').notNull(),
    isGroup: integer('is_group').notNull().default(0),
    address: text('address').notNull().default(''),
    lastInAt: integer('last_in_at'),
    lastInSender: text('last_in_sender').notNull().default(''),
    lastInText: text('last_in_text').notNull().default(''), // first 200 characters
    lastOutAt: integer('last_out_at'),
    waitingSince: integer('waiting_since'), // first message after my last reply
    unanswered: integer('unanswered').notNull().default(0),
    seenAt: integer('seen_at'),
    doneAt: integer('done_at'), // done while done_at >= last_in_at
    snoozedUntil: integer('snoozed_until'),
    muted: integer('muted').notNull().default(0),
    neverAi: integer('never_ai').notNull().default(0),
    vip: integer('vip').notNull().default(0),
    live: integer('live').notNull().default(0),
    triageStatus: text('triage_status').notNull().default('none'), // none | pending | done | failed | skipped
    triageSource: text('triage_source').notNull().default('rules'),
    tier: integer('tier').notNull().default(3),
    category: text('category').notNull().default('unknown'),
    replyNeeded: text('reply_needed').notNull().default('no'),
    summary: text('summary').notNull().default(''),
    why: text('why').notNull().default(''),
    replyBy: text('reply_by'),
    model: text('model').notNull().default(''),
    triagedUpto: integer('triaged_upto').notNull().default(0), // newest message time the triage saw
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: integer('next_attempt_at').notNull().default(0),
    nudgeLevel: integer('nudge_level').notNull().default(0), // for the current wait
    urgentAlerted: integer('urgent_alerted').notNull().default(0), // waiting_since of the last urgent alert
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    revision: integer('revision').notNull().default(1),
  },
  (t) => [
    uniqueIndex('ch_threads_chat').on(t.member, t.chatKey),
    index('ch_threads_recent').on(t.member, t.lastInAt),
    index('ch_threads_triage').on(t.member, t.triageStatus, t.nextAttemptAt),
  ],
);
// Messages, kept for 30 days. The phone's message id (a hash) makes each message stored once.
export const chMessages = sqliteTable(
  'ch_messages',
  {
    id: text('id').primaryKey(),
    member: text('member').notNull(),
    threadId: text('thread_id').notNull(),
    msgHash: text('msg_hash').notNull(),
    sender: text('sender').notNull(),
    fromMe: integer('from_me').notNull().default(0),
    text: text('text').notNull(),
    at: integer('at').notNull(),
    receivedAt: integer('received_at').notNull(),
  },
  (t) => [
    uniqueIndex('ch_messages_hash').on(t.member, t.msgHash),
    index('ch_messages_thread').on(t.threadId, t.at),
    index('ch_messages_age').on(t.receivedAt),
  ],
);
export const chDrafts = sqliteTable(
  'ch_drafts',
  {
    id: text('id').primaryKey(),
    member: text('member').notNull(),
    threadId: text('thread_id').notNull(),
    text: text('text').notNull(),
    status: text('status').notNull(), // draft | sent | discarded
    how: text('how'), // notification | manual
    model: text('model').notNull().default(''),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    sentAt: integer('sent_at'),
    revision: integer('revision').notNull().default(1),
  },
  (t) => [index('ch_drafts_thread').on(t.member, t.threadId, t.status)],
);
export const chSettings = sqliteTable('ch_settings', {
  member: text('member').primaryKey(),
  settingsJson: text('settings_json').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// ---------- Agents: automated workflows described in plain words ----------

export const agAgents = sqliteTable(
  'ag_agents',
  {
    id: text('id').primaryKey(),
    member: text('member').notNull(),
    name: text('name').notNull(),
    instruction: text('instruction').notNull(),
    triggerJson: text('trigger_json').notNull(),
    status: text('status').notNull(), // active | paused
    notes: text('notes').notNull().default(''), // kept between runs, written by the agent
    templateId: text('template_id'),
    nextRunAt: integer('next_run_at'), // schedules
    eventCursor: integer('event_cursor').notNull().default(0), // events: notices up to this time are handled
    lastRunAt: integer('last_run_at'),
    statsJson: text('stats_json').notNull().default('{}'),
    limitCalls: integer('limit_calls').notNull().default(300), // AI calls a month; 0: no limit
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    revision: integer('revision').notNull().default(1),
  },
  (t) => [index('ag_agents_member').on(t.member), index('ag_agents_due').on(t.status, t.nextRunAt)],
);
export const agRuns = sqliteTable(
  'ag_runs',
  {
    id: text('id').primaryKey(),
    member: text('member').notNull(),
    agentId: text('agent_id'),
    agentName: text('agent_name').notNull(),
    trigger: text('trigger').notNull(), // command | manual | schedule | event
    status: text('status').notNull(), // running | done | failed
    command: text('command').notNull(),
    summary: text('summary').notNull().default(''),
    stepsJson: text('steps_json').notNull().default('[]'),
    error: text('error').notNull().default(''),
    rating: integer('rating').notNull().default(0),
    feedback: text('feedback').notNull().default(''),
    aiCalls: integer('ai_calls').notNull().default(0), // model calls made by this run, with learning
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
  },
  (t) => [
    index('ag_runs_member').on(t.member, t.startedAt),
    index('ag_runs_agent').on(t.agentId, t.startedAt),
  ],
);
export const agApprovals = sqliteTable(
  'ag_approvals',
  {
    id: text('id').primaryKey(),
    member: text('member').notNull(),
    agentId: text('agent_id'),
    agentName: text('agent_name').notNull(),
    runId: text('run_id').notNull(),
    action: text('action').notNull(), // send_email | create_task
    payloadJson: text('payload_json').notNull(),
    title: text('title').notNull(),
    detail: text('detail').notNull(),
    reason: text('reason').notNull(),
    link: text('link').notNull(),
    status: text('status').notNull(), // pending | approved | rejected | failed | expired
    result: text('result').notNull().default(''),
    createdAt: integer('created_at').notNull(),
    decidedAt: integer('decided_at'),
  },
  (t) => [index('ag_approvals_member').on(t.member, t.status, t.createdAt)],
);
export const agLessons = sqliteTable(
  'ag_lessons',
  {
    id: text('id').primaryKey(),
    member: text('member').notNull(),
    agentId: text('agent_id'), // null: every agent
    text: text('text').notNull(),
    source: text('source').notNull(), // agent | feedback | approval | review | member
    uses: integer('uses').notNull().default(0),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('ag_lessons_member').on(t.member, t.agentId)],
);
export const agTemplates = sqliteTable('ag_templates', {
  id: text('id').primaryKey(),
  author: text('author').notNull(),
  authorName: text('author_name').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  instruction: text('instruction').notNull(),
  triggerJson: text('trigger_json').notNull(),
  copies: integer('copies').notNull().default(0),
  createdAt: integer('created_at').notNull(),
});
