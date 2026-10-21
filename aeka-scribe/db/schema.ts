import {sqliteTable,text,integer,primaryKey} from 'drizzle-orm/sqlite-core';
export const workspaceNotes=sqliteTable('workspace_notes',{owner:text('owner').notNull(),id:text('id').notNull(),value:text('value').notNull(),updatedAt:integer('updated_at').notNull() },table=>[primaryKey({columns:[table.owner,table.id]})]);

export const workspaceDeleted=sqliteTable('workspace_deleted',{owner:text('owner').notNull(),id:text('id').notNull(),updatedAt:integer('updated_at').notNull()},t=>[primaryKey({columns:[t.owner,t.id]})]);
export const workspacePolicy=sqliteTable('workspace_policy',{owner:text('owner').primaryKey(),value:text('value').notNull()});
export const workspaceGrants=sqliteTable('workspace_grants',{owner:text('owner').notNull(),kind:text('kind').notNull(),target:text('target').notNull(),email:text('email').notNull(),role:text('role').notNull(),expiresAt:integer('expires_at').notNull()},t=>[primaryKey({columns:[t.owner,t.kind,t.target,t.email]})]);
export const workspaceComments=sqliteTable('workspace_comments',{id:text('id').notNull(),owner:text('owner').notNull(),noteId:text('note_id').notNull(),author:text('author').notNull(),email:text('email').notNull(),text:text('text').notNull(),at:integer('at').notNull()},t=>[primaryKey({columns:[t.owner,t.noteId,t.id]})]);
export const workspaceAudit=sqliteTable('workspace_audit',{id:text('id').primaryKey(),owner:text('owner').notNull(),actor:text('actor').notNull(),action:text('action').notNull(),target:text('target').notNull(),at:integer('at').notNull()});
export const workspaceResources=sqliteTable('workspace_resources',{owner:text('owner').primaryKey(),value:text('value').notNull(),revision:integer('revision').notNull()});

export const workspaceStudio=sqliteTable('workspace_studio',{owner:text('owner').primaryKey(),value:text('value').notNull(),revision:integer('revision').notNull()});
