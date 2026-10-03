CREATE TABLE `ad_breakdowns` (
	`level` text NOT NULL,
	`entity_id` text NOT NULL,
	`date` text NOT NULL,
	`breakdown` text NOT NULL,
	`value` text NOT NULL,
	`account_id` text NOT NULL,
	`spend` real DEFAULT 0 NOT NULL,
	`impressions` integer DEFAULT 0 NOT NULL,
	`clicks` integer,
	`link_clicks` integer,
	`actions` text,
	`action_values` text,
	`fetched_at` text NOT NULL,
	PRIMARY KEY(`level`, `entity_id`, `date`, `breakdown`, `value`)
);
--> statement-breakpoint
CREATE INDEX `ad_breakdowns_account_idx` ON `ad_breakdowns` (`account_id`,`level`,`breakdown`,`date`);--> statement-breakpoint
CREATE TABLE `ad_range_stats` (
	`level` text NOT NULL,
	`entity_id` text NOT NULL,
	`since` text NOT NULL,
	`until` text NOT NULL,
	`account_id` text NOT NULL,
	`reach` integer,
	`frequency` real,
	`unique_link_clicks` integer,
	`unique_link_ctr` real,
	`fetched_at` text NOT NULL,
	PRIMARY KEY(`level`, `entity_id`, `since`, `until`)
);
--> statement-breakpoint
CREATE INDEX `ad_range_account_idx` ON `ad_range_stats` (`account_id`,`since`,`until`);--> statement-breakpoint
CREATE TABLE `creative_links` (
	`record_id` text NOT NULL,
	`ad_id` text NOT NULL,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`record_id`, `ad_id`)
);
--> statement-breakpoint
CREATE INDEX `creative_links_ad_idx` ON `creative_links` (`ad_id`);--> statement-breakpoint
ALTER TABLE `ad_accounts` ADD `breakdowns` text;--> statement-breakpoint
ALTER TABLE `ad_accounts` ADD `activity_at` text;--> statement-breakpoint
ALTER TABLE `ad_jobs` ADD `breakdown` text;--> statement-breakpoint
ALTER TABLE `ad_objects` ADD `last_edit` text;