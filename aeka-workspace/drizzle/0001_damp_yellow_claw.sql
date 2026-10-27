CREATE TABLE `workspace_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_comments` (
	`id` text NOT NULL,
	`owner` text NOT NULL,
	`note_id` text NOT NULL,
	`author` text NOT NULL,
	`email` text NOT NULL,
	`text` text NOT NULL,
	`at` integer NOT NULL,
	PRIMARY KEY(`owner`, `note_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `workspace_deleted` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE TABLE `workspace_grants` (
	`owner` text NOT NULL,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`owner`, `kind`, `target`, `email`)
);
--> statement-breakpoint
CREATE TABLE `workspace_policy` (
	`owner` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_resources` (
	`owner` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`revision` integer NOT NULL
);
