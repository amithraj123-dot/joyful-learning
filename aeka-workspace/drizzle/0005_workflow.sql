CREATE TABLE `wf_billing` (
	`matter_id` text PRIMARY KEY NOT NULL,
	`el_status` text NOT NULL,
	`invoice_status` text NOT NULL,
	`fee_paise` integer,
	`admin_notes` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wf_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`notes` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`revision` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE TABLE `wf_deals` (
	`matter_id` text PRIMARY KEY NOT NULL,
	`deal_value` text NOT NULL,
	`representing` text NOT NULL,
	`target_company` text NOT NULL,
	`target_docs` text NOT NULL,
	`counterparties` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wf_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`member` text NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`rating` integer,
	`author` text NOT NULL,
	`updated_at` integer NOT NULL,
	`revision` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wf_feedback_member` ON `wf_feedback` (`matter_id`,`member`,`kind`);--> statement-breakpoint
CREATE TABLE `wf_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`invoice_no` text NOT NULL,
	`date` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`entity` text NOT NULL,
	`notes` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `wf_invoices_matter` ON `wf_invoices` (`matter_id`);--> statement-breakpoint
CREATE TABLE `wf_matters` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`stage` text NOT NULL,
	`priority` integer NOT NULL,
	`note` text NOT NULL,
	`team` text NOT NULL,
	`restricted` integer NOT NULL,
	`peer_feedback_visible` integer NOT NULL,
	`is_deal` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`revision` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `wf_matters_client` ON `wf_matters` (`client_id`);--> statement-breakpoint
CREATE TABLE `wf_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wf_milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`due_date` text NOT NULL,
	`done` integer NOT NULL,
	`owner` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`revision` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `wf_milestones_matter` ON `wf_milestones` (`matter_id`);--> statement-breakpoint
CREATE TABLE `wf_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`assignee` text,
	`prepared_by` text,
	`reviewed_by` text,
	`reviewed_at` integer,
	`due_date` text,
	`priority` integer NOT NULL,
	`notes` text NOT NULL,
	`steps` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`revision` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `wf_tasks_matter` ON `wf_tasks` (`matter_id`);--> statement-breakpoint
CREATE TABLE `wf_time` (
	`id` text PRIMARY KEY NOT NULL,
	`matter_id` text NOT NULL,
	`person` text NOT NULL,
	`date` text NOT NULL,
	`minutes` integer NOT NULL,
	`description` text NOT NULL,
	`billable` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `wf_time_person_date` ON `wf_time` (`person`,`date`);--> statement-breakpoint
CREATE INDEX `wf_time_date` ON `wf_time` (`date`);--> statement-breakpoint
CREATE INDEX `wf_time_matter` ON `wf_time` (`matter_id`);