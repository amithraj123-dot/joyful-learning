import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';
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
