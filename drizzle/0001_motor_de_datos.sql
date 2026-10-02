CREATE TABLE `field_defs` (
	`id` text PRIMARY KEY NOT NULL,
	`entity` text NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`type` text NOT NULL,
	`config` text NOT NULL,
	`position` integer NOT NULL,
	`visible` integer NOT NULL,
	`required` integer NOT NULL,
	`system` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `field_defs_entity_key_idx` ON `field_defs` (`entity`,`key`);--> statement-breakpoint
CREATE TABLE `history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`record_id` text NOT NULL,
	`entity` text NOT NULL,
	`at` text NOT NULL,
	`action` text NOT NULL,
	`changes` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `history_record_idx` ON `history` (`record_id`,`at`);--> statement-breakpoint
CREATE TABLE `links` (
	`field_id` text NOT NULL,
	`from_id` text NOT NULL,
	`to_id` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`field_id`, `from_id`, `to_id`)
);
--> statement-breakpoint
CREATE INDEX `links_from_idx` ON `links` (`from_id`);--> statement-breakpoint
CREATE INDEX `links_to_idx` ON `links` (`to_id`);--> statement-breakpoint
CREATE TABLE `records` (
	`id` text PRIMARY KEY NOT NULL,
	`entity` text NOT NULL,
	`data` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `records_entity_idx` ON `records` (`entity`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `records_updated_idx` ON `records` (`updated_at`);--> statement-breakpoint
CREATE TABLE `views` (
	`id` text PRIMARY KEY NOT NULL,
	`entity` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`config` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `views_entity_idx` ON `views` (`entity`);