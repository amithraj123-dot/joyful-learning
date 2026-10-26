import { sqliteTable, text, integer, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
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
