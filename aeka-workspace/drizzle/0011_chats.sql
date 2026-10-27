CREATE TABLE `ch_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`member` text NOT NULL,
	`name` text NOT NULL,
	`model` text NOT NULL,
	`app_version` text NOT NULL,
	`android` integer NOT NULL,
	`secret_hash` text NOT NULL,
	`access_json` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE INDEX `ch_devices_member` ON `ch_devices` (`member`);--> statement-breakpoint
CREATE TABLE `ch_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`member` text NOT NULL,
	`thread_id` text NOT NULL,
	`text` text NOT NULL,
	`status` text NOT NULL,
	`how` text,
	`model` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`sent_at` integer,
	`revision` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ch_drafts_thread` ON `ch_drafts` (`member`,`thread_id`,`status`);--> statement-breakpoint
CREATE TABLE `ch_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`member` text NOT NULL,
	`thread_id` text NOT NULL,
	`msg_hash` text NOT NULL,
	`sender` text NOT NULL,
	`from_me` integer DEFAULT 0 NOT NULL,
	`text` text NOT NULL,
	`at` integer NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ch_messages_hash` ON `ch_messages` (`member`,`msg_hash`);--> statement-breakpoint
CREATE INDEX `ch_messages_thread` ON `ch_messages` (`thread_id`,`at`);--> statement-breakpoint
CREATE INDEX `ch_messages_age` ON `ch_messages` (`received_at`);--> statement-breakpoint
CREATE TABLE `ch_pairings` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`member` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer
);
--> statement-breakpoint
CREATE TABLE `ch_settings` (
	`member` text PRIMARY KEY NOT NULL,
	`settings_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ch_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`member` text NOT NULL,
	`app` text NOT NULL,
	`chat_key` text NOT NULL,
	`title` text NOT NULL,
	`is_group` integer DEFAULT 0 NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`last_in_at` integer,
	`last_in_sender` text DEFAULT '' NOT NULL,
	`last_in_text` text DEFAULT '' NOT NULL,
	`last_out_at` integer,
	`waiting_since` integer,
	`unanswered` integer DEFAULT 0 NOT NULL,
	`seen_at` integer,
	`done_at` integer,
	`snoozed_until` integer,
	`muted` integer DEFAULT 0 NOT NULL,
	`never_ai` integer DEFAULT 0 NOT NULL,
	`vip` integer DEFAULT 0 NOT NULL,
	`live` integer DEFAULT 0 NOT NULL,
	`triage_status` text DEFAULT 'none' NOT NULL,
	`triage_source` text DEFAULT 'rules' NOT NULL,
	`tier` integer DEFAULT 3 NOT NULL,
	`category` text DEFAULT 'unknown' NOT NULL,
	`reply_needed` text DEFAULT 'no' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`why` text DEFAULT '' NOT NULL,
	`reply_by` text,
	`model` text DEFAULT '' NOT NULL,
	`triaged_upto` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer DEFAULT 0 NOT NULL,
	`nudge_level` integer DEFAULT 0 NOT NULL,
	`urgent_alerted` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ch_threads_chat` ON `ch_threads` (`member`,`chat_key`);--> statement-breakpoint
CREATE INDEX `ch_threads_recent` ON `ch_threads` (`member`,`last_in_at`);--> statement-breakpoint
CREATE INDEX `ch_threads_triage` ON `ch_threads` (`member`,`triage_status`,`next_attempt_at`);