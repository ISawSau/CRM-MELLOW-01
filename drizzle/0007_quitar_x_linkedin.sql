-- X y LinkedIn se quitan de la app (D-091). La app hace una copia de seguridad de la
-- bóveda antes de aplicar esta migración. Solo se borran sus cuentas, sus datos y sus ajustes.
DELETE FROM `creative_links` WHERE `ad_id` IN (SELECT `id` FROM `ad_objects` WHERE `account_id` IN (SELECT `id` FROM `ad_accounts` WHERE `platform` <> 'meta'));--> statement-breakpoint
DELETE FROM `ad_actions` WHERE `account_id` IN (SELECT `id` FROM `ad_accounts` WHERE `platform` <> 'meta');--> statement-breakpoint
DELETE FROM `ad_creatives` WHERE `account_id` IN (SELECT `id` FROM `ad_accounts` WHERE `platform` <> 'meta');--> statement-breakpoint
DELETE FROM `ad_insights_daily` WHERE `account_id` IN (SELECT `id` FROM `ad_accounts` WHERE `platform` <> 'meta');--> statement-breakpoint
DELETE FROM `ad_jobs` WHERE `account_id` IN (SELECT `id` FROM `ad_accounts` WHERE `platform` <> 'meta');--> statement-breakpoint
DELETE FROM `ad_objects` WHERE `account_id` IN (SELECT `id` FROM `ad_accounts` WHERE `platform` <> 'meta');--> statement-breakpoint
DELETE FROM `ad_breakdowns` WHERE `account_id` IN (SELECT `id` FROM `ad_accounts` WHERE `platform` <> 'meta');--> statement-breakpoint
DELETE FROM `ad_range_stats` WHERE `account_id` IN (SELECT `id` FROM `ad_accounts` WHERE `platform` <> 'meta');--> statement-breakpoint
DELETE FROM `ad_accounts` WHERE `platform` <> 'meta';--> statement-breakpoint
DELETE FROM `settings` WHERE `key` IN ('linkedin.config', 'linkedin.enabled', 'platforms.mappings');
