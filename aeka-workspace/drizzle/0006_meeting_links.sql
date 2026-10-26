CREATE TABLE `wf_meeting_links` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`owner_user` text NOT NULL,
	`note_id` text NOT NULL,
	`title` text NOT NULL,
	`meeting_at` integer NOT NULL,
	`attendees` text NOT NULL,
	`summary` text NOT NULL,
	`actions` text NOT NULL,
	`include_transcript` integer NOT NULL,
	`transcript_chars` integer NOT NULL,
	`linked_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`revision` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wf_meeting_links_note` ON `wf_meeting_links` (`matter_id`,`owner_user`,`note_id`);--> statement-breakpoint
CREATE INDEX `wf_meeting_links_owner` ON `wf_meeting_links` (`owner_user`,`note_id`);--> statement-breakpoint
CREATE TABLE `wf_meeting_transcripts` (
	`link_id` text PRIMARY KEY NOT NULL,
	`transcript` text NOT NULL
);
