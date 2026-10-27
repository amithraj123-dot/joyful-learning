CREATE TABLE `ag_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`member` text NOT NULL,
	`name` text NOT NULL,
	`instruction` text NOT NULL,
	`trigger_json` text NOT NULL,
	`status` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`template_id` text,
	`next_run_at` integer,
	`event_cursor` integer DEFAULT 0 NOT NULL,
	`last_run_at` integer,
	`stats_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ag_agents_member` ON `ag_agents` (`member`);--> statement-breakpoint
CREATE INDEX `ag_agents_due` ON `ag_agents` (`status`,`next_run_at`);--> statement-breakpoint
CREATE TABLE `ag_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`member` text NOT NULL,
	`agent_id` text,
	`agent_name` text NOT NULL,
	`run_id` text NOT NULL,
	`action` text NOT NULL,
	`payload_json` text NOT NULL,
	`title` text NOT NULL,
	`detail` text NOT NULL,
	`reason` text NOT NULL,
	`link` text NOT NULL,
	`status` text NOT NULL,
	`result` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`decided_at` integer
);
--> statement-breakpoint
CREATE INDEX `ag_approvals_member` ON `ag_approvals` (`member`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `ag_lessons` (
	`id` text PRIMARY KEY NOT NULL,
	`member` text NOT NULL,
	`agent_id` text,
	`text` text NOT NULL,
	`source` text NOT NULL,
	`uses` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ag_lessons_member` ON `ag_lessons` (`member`,`agent_id`);--> statement-breakpoint
CREATE TABLE `ag_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`member` text NOT NULL,
	`agent_id` text,
	`agent_name` text NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`command` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`steps_json` text DEFAULT '[]' NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`rating` integer DEFAULT 0 NOT NULL,
	`feedback` text DEFAULT '' NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `ag_runs_member` ON `ag_runs` (`member`,`started_at`);--> statement-breakpoint
CREATE INDEX `ag_runs_agent` ON `ag_runs` (`agent_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `ag_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`author` text NOT NULL,
	`author_name` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`instruction` text NOT NULL,
	`trigger_json` text NOT NULL,
	`copies` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
