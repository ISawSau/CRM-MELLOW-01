CREATE TABLE `sync_outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tbl` text NOT NULL,
	`key` text NOT NULL,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_outbox_row` ON `sync_outbox` (`tbl`,`key`);--> statement-breakpoint
CREATE TABLE `sync_rows` (
	`tbl` text NOT NULL,
	`key` text NOT NULL,
	`ts` integer NOT NULL,
	`dev` text NOT NULL,
	PRIMARY KEY(`tbl`, `key`)
);
