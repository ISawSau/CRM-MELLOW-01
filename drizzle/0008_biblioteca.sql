CREATE TABLE `book_progress` (
	`record_id` text PRIMARY KEY NOT NULL,
	`location` text NOT NULL,
	`fraction` real NOT NULL,
	`page` integer,
	`pages` integer,
	`chapter` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reading_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`record_id` text NOT NULL,
	`day` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text NOT NULL,
	`seconds` integer NOT NULL,
	`from_fraction` real NOT NULL,
	`to_fraction` real NOT NULL,
	`pages` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reading_sessions_day_idx` ON `reading_sessions` (`day`);--> statement-breakpoint
CREATE INDEX `reading_sessions_record_idx` ON `reading_sessions` (`record_id`);