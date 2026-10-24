CREATE TABLE `workspace_notes` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
