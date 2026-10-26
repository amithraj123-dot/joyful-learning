CREATE TABLE `mail_events` (
	`member` text NOT NULL,
	`id` text NOT NULL,
	`subject` text NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`all_day` integer NOT NULL,
	`location` text NOT NULL,
	`online_url` text NOT NULL,
	`organizer_json` text NOT NULL,
	`attendees_json` text NOT NULL,
	`is_organizer` integer NOT NULL,
	`response` text NOT NULL,
	`show_as` text NOT NULL,
	`cancelled` integer NOT NULL,
	`web_link` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`member`, `id`)
);
--> statement-breakpoint
CREATE INDEX `mail_events_start` ON `mail_events` (`member`,`start_at`);--> statement-breakpoint
ALTER TABLE `mail_accounts` ADD `calendar_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `mail_accounts` ADD `calendar_synced_at` integer;