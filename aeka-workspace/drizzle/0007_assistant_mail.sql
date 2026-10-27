CREATE TABLE `ai_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`actor` text NOT NULL,
	`module` text NOT NULL,
	`purpose` text NOT NULL,
	`model` text NOT NULL,
	`ok` integer NOT NULL,
	`prompt_tokens` integer NOT NULL,
	`completion_tokens` integer NOT NULL,
	`error` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_usage_actor_at` ON `ai_usage` (`actor`,`at`);--> statement-breakpoint
CREATE TABLE `as_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`member` text NOT NULL,
	`title` text NOT NULL,
	`channel` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `as_conversations_member` ON `as_conversations` (`member`,`updated_at`);--> statement-breakpoint
CREATE TABLE `as_memory` (
	`id` text PRIMARY KEY NOT NULL,
	`member` text NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `as_memory_member` ON `as_memory` (`member`,`updated_at`);--> statement-breakpoint
CREATE TABLE `as_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`member` text NOT NULL,
	`seq` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`tool` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `as_messages_seq` ON `as_messages` (`conversation_id`,`seq`);--> statement-breakpoint
CREATE TABLE `as_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`member` text NOT NULL,
	`phone` text NOT NULL,
	`body` text NOT NULL,
	`status` text NOT NULL,
	`provider_id` text,
	`error` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `as_outbox_status` ON `as_outbox` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `as_outbox_provider` ON `as_outbox` (`provider_id`);--> statement-breakpoint
CREATE TABLE `as_reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`member` text NOT NULL,
	`title` text NOT NULL,
	`due_at` integer NOT NULL,
	`repeat` text NOT NULL,
	`status` text NOT NULL,
	`last_fired_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`revision` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `as_reminders_due` ON `as_reminders` (`status`,`due_at`);--> statement-breakpoint
CREATE INDEX `as_reminders_member` ON `as_reminders` (`member`);--> statement-breakpoint
CREATE TABLE `as_settings` (
	`member` text PRIMARY KEY NOT NULL,
	`settings` text NOT NULL,
	`whatsapp_phone` text,
	`link_code` text,
	`link_expires` integer,
	`last_inbound_at` integer,
	`last_brief_date` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `as_settings_phone` ON `as_settings` (`whatsapp_phone`);--> statement-breakpoint
CREATE TABLE `as_todos` (
	`id` text PRIMARY KEY NOT NULL,
	`member` text NOT NULL,
	`title` text NOT NULL,
	`details` text NOT NULL,
	`status` text NOT NULL,
	`priority` text NOT NULL,
	`due_at` integer,
	`source` text NOT NULL,
	`source_ref` text NOT NULL,
	`task_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`done_at` integer,
	`revision` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `as_todos_member` ON `as_todos` (`member`,`status`,`due_at`);--> statement-breakpoint
CREATE TABLE `as_whatsapp_events` (
	`id` text PRIMARY KEY NOT NULL,
	`member` text,
	`body` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `core_leases` (
	`name` text PRIMARY KEY NOT NULL,
	`until` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mail_accounts` (
	`member` text PRIMARY KEY NOT NULL,
	`address` text NOT NULL,
	`display_name` text NOT NULL,
	`token_sealed` text NOT NULL,
	`access_expires` integer NOT NULL,
	`status` text NOT NULL,
	`inbox_delta` text,
	`sent_delta` text,
	`last_sync_at` integer,
	`last_error` text DEFAULT '' NOT NULL,
	`settings` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mail_corrections` (
	`id` text PRIMARY KEY NOT NULL,
	`member` text NOT NULL,
	`message_id` text NOT NULL,
	`field` text NOT NULL,
	`from_value` text NOT NULL,
	`to_value` text NOT NULL,
	`sender` text NOT NULL,
	`domain` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mail_corrections_member` ON `mail_corrections` (`member`,`created_at`);--> statement-breakpoint
CREATE INDEX `mail_corrections_sender` ON `mail_corrections` (`member`,`sender`);--> statement-breakpoint
CREATE TABLE `mail_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`member` text NOT NULL,
	`message_id` text NOT NULL,
	`graph_draft_id` text,
	`body` text NOT NULL,
	`reply_all` integer NOT NULL,
	`to_json` text NOT NULL,
	`cc_json` text NOT NULL,
	`status` text NOT NULL,
	`placeholders` integer NOT NULL,
	`model` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`sent_at` integer,
	`revision` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mail_drafts_message` ON `mail_drafts` (`member`,`message_id`);--> statement-breakpoint
CREATE TABLE `mail_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`member` text NOT NULL,
	`graph_id` text NOT NULL,
	`internet_message_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`folder` text NOT NULL,
	`subject` text NOT NULL,
	`from_address` text NOT NULL,
	`from_name` text NOT NULL,
	`to_json` text NOT NULL,
	`cc_json` text NOT NULL,
	`received_at` integer NOT NULL,
	`preview` text NOT NULL,
	`body_text` text NOT NULL,
	`has_attachments` integer NOT NULL,
	`importance` text NOT NULL,
	`is_read` integer NOT NULL,
	`bulk` integer NOT NULL,
	`web_link` text NOT NULL,
	`removed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_messages_graph` ON `mail_messages` (`member`,`graph_id`);--> statement-breakpoint
CREATE INDEX `mail_messages_received` ON `mail_messages` (`member`,`folder`,`received_at`);--> statement-breakpoint
CREATE INDEX `mail_messages_conversation` ON `mail_messages` (`member`,`conversation_id`);--> statement-breakpoint
CREATE TABLE `mail_oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`member` text NOT NULL,
	`verifier_sealed` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mail_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`member` text NOT NULL,
	`kind` text NOT NULL,
	`pattern` text NOT NULL,
	`effect` text NOT NULL,
	`status` text NOT NULL,
	`evidence` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_rules_pattern` ON `mail_rules` (`member`,`kind`,`pattern`);--> statement-breakpoint
CREATE TABLE `mail_triage` (
	`message_id` text PRIMARY KEY NOT NULL,
	`member` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`source` text NOT NULL,
	`tier` integer NOT NULL,
	`category` text NOT NULL,
	`handling` text NOT NULL,
	`why` text NOT NULL,
	`deadline` text,
	`asks` text NOT NULL,
	`reply_needed` text NOT NULL,
	`draft_decision` text NOT NULL,
	`delegate` text,
	`matter_id` text,
	`matter_confidence` text,
	`confidence` real NOT NULL,
	`safety_flag` text,
	`corrected` integer NOT NULL,
	`model` text NOT NULL,
	`error` text NOT NULL,
	`triaged_at` integer,
	`updated_at` integer NOT NULL,
	`revision` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mail_triage_queue` ON `mail_triage` (`member`,`status`,`handling`,`tier`);--> statement-breakpoint
CREATE INDEX `mail_triage_due` ON `mail_triage` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `org_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`recipient` text NOT NULL,
	`module` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`link` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`read_at` integer,
	`delivered` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `org_notifications_dedupe` ON `org_notifications` (`recipient`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `org_notifications_recipient` ON `org_notifications` (`recipient`,`created_at`);