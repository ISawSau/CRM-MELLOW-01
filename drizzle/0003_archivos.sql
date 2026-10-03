CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`size` integer NOT NULL,
	`mime` text NOT NULL,
	`width` integer,
	`height` integer,
	`duration` integer,
	`has_thumb` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`record_id` text NOT NULL,
	`number` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`data` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `versions_record_number` ON `versions` (`record_id`,`number`);