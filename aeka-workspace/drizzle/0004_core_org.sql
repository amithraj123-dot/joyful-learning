CREATE TABLE `org_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`actor` text NOT NULL,
	`actor_name` text NOT NULL,
	`module` text NOT NULL,
	`action` text NOT NULL,
	`target` text NOT NULL,
	`summary` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `org_activity_at` ON `org_activity` (`at`);--> statement-breakpoint
CREATE INDEX `org_activity_target` ON `org_activity` (`target`);--> statement-breakpoint
CREATE TABLE `org_members` (
	`email` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`initials` text NOT NULL,
	`designation` text NOT NULL,
	`is_admin` integer NOT NULL,
	`active` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
