CREATE TABLE `ad_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`name` text NOT NULL,
	`currency` text NOT NULL,
	`timezone` text NOT NULL,
	`status` integer,
	`business` text,
	`enabled` integer DEFAULT false NOT NULL,
	`client_id` text,
	`data_from` text,
	`data_until` text,
	`history_done` integer DEFAULT false NOT NULL,
	`last_sync_at` text,
	`last_error` text,
	`raw` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ad_action_types` (
	`action_type` text PRIMARY KEY NOT NULL,
	`first_seen` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ad_actions` (
	`level` text NOT NULL,
	`entity_id` text NOT NULL,
	`date` text NOT NULL,
	`action_type` text NOT NULL,
	`account_id` text NOT NULL,
	`count` real,
	`value` real,
	PRIMARY KEY(`level`, `entity_id`, `date`, `action_type`)
);
--> statement-breakpoint
CREATE INDEX `ad_actions_account_idx` ON `ad_actions` (`account_id`,`level`,`date`);--> statement-breakpoint
CREATE TABLE `ad_creatives` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`name` text,
	`title` text,
	`body` text,
	`object_type` text,
	`call_to_action` text,
	`link_url` text,
	`video_id` text,
	`thumbnail_url` text,
	`thumb_file_id` text,
	`raw` text NOT NULL,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ad_insights_daily` (
	`level` text NOT NULL,
	`entity_id` text NOT NULL,
	`date` text NOT NULL,
	`account_id` text NOT NULL,
	`campaign_id` text,
	`adset_id` text,
	`spend` real DEFAULT 0 NOT NULL,
	`impressions` integer DEFAULT 0 NOT NULL,
	`reach` integer,
	`frequency` real,
	`clicks` integer,
	`link_clicks` integer,
	`unique_link_clicks` integer,
	`link_ctr` real,
	`unique_link_ctr` real,
	`cpm` real,
	`cpc` real,
	`quality_ranking` text,
	`engagement_ranking` text,
	`conversion_ranking` text,
	`actions` text,
	`action_values` text,
	`extra` text,
	`fetched_at` text NOT NULL,
	PRIMARY KEY(`level`, `entity_id`, `date`)
);
--> statement-breakpoint
CREATE INDEX `ad_insights_account_idx` ON `ad_insights_daily` (`account_id`,`level`,`date`);--> statement-breakpoint
CREATE TABLE `ad_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`level` text NOT NULL,
	`since` text NOT NULL,
	`until` text NOT NULL,
	`status` text NOT NULL,
	`report_run_id` text,
	`started_at` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `ad_jobs_account_idx` ON `ad_jobs` (`account_id`,`status`);--> statement-breakpoint
CREATE TABLE `ad_objects` (
	`id` text PRIMARY KEY NOT NULL,
	`level` text NOT NULL,
	`account_id` text NOT NULL,
	`campaign_id` text,
	`adset_id` text,
	`name` text NOT NULL,
	`status` text,
	`effective_status` text,
	`objective` text,
	`bid_strategy` text,
	`daily_budget` integer,
	`lifetime_budget` integer,
	`start_time` text,
	`end_time` text,
	`creative_id` text,
	`updated_time` text,
	`raw` text NOT NULL,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ad_objects_account_idx` ON `ad_objects` (`account_id`,`level`);--> statement-breakpoint
CREATE INDEX `ad_objects_parent_idx` ON `ad_objects` (`campaign_id`,`adset_id`);--> statement-breakpoint
CREATE TABLE `fx_rates` (
	`date` text NOT NULL,
	`currency` text NOT NULL,
	`rate` real NOT NULL,
	PRIMARY KEY(`date`, `currency`)
);
