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
  createdAt: integer('created_at').notNull(),
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
  },
  (t) => [index('as_todos_member').on(t.member, t.status, t.dueAt)],
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
