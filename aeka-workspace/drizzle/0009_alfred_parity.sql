CREATE TABLE `as_meeting_preps` (
	`member` text NOT NULL,
	`event_id` text NOT NULL,
	`event_start` integer NOT NULL,
	`summary` text NOT NULL,
	`model` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`member`, `event_id`, `event_start`)
);
--> statement-breakpoint
CREATE TABLE `mail_style` (
	`member` text PRIMARY KEY NOT NULL,
	`profile` text NOT NULL,
	`status` text NOT NULL,
	`sample_count` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mail_threads` (
	`member` text NOT NULL,
	`conversation_id` text NOT NULL,
	`waiting_snoozed_until` integer,
	`waiting_done` integer DEFAULT 0 NOT NULL,
	`chasing_done` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`member`, `conversation_id`)
);
--> statement-breakpoint
ALTER TABLE `as_todos` ADD `list` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `as_todos` ADD `source_label` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `as_todos` ADD `repeat` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `as_todos_source` ON `as_todos` (`member`,`source`,`source_ref`) WHERE source_ref != '';--> statement-breakpoint
ALTER TABLE `mail_messages` ADD `commitments_at` integer;--> statement-breakpoint
ALTER TABLE `mail_messages` ADD `meeting_start` integer;--> statement-breakpoint
ALTER TABLE `mail_messages` ADD `meeting_end` integer;