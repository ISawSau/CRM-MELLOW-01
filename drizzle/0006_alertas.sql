CREATE TABLE `alert_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`alert_id` text NOT NULL,
	`since` text NOT NULL,
	`until` text NOT NULL,
	`value` real NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` text NOT NULL,
	`seen_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alert_events_period` ON `alert_events` (`alert_id`,`until`);