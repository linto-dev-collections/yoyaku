CREATE TABLE `projection_dead_letters` (
	`event_id` text PRIMARY KEY NOT NULL,
	`aggregate_type` text NOT NULL,
	`aggregate_id` text NOT NULL,
	`seq` integer NOT NULL,
	`event_type` text NOT NULL,
	`payload` text,
	`last_error` text,
	`attempts` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`first_seen_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`last_seen_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `projection_dead_letters_status_idx` ON `projection_dead_letters` (`status`);--> statement-breakpoint
CREATE INDEX `projection_dead_letters_aggregate_idx` ON `projection_dead_letters` (`aggregate_type`,`aggregate_id`);--> statement-breakpoint
CREATE TABLE `aggregate_registry` (
	`aggregate_type` text NOT NULL,
	`aggregate_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`aggregate_type`, `aggregate_id`)
);
--> statement-breakpoint
-- One-time backfill: 既存集約 ID を現行 read model から取り込む（このマイグレーション以前に作成された
-- 集約を取りこぼさない）。以後の新規集約は aggregate-registry.projection が登録する。冪等（PK 衝突は無視）。
INSERT INTO `aggregate_registry` (`aggregate_type`, `aggregate_id`, `created_at`)
SELECT 'Showing', `showing_id`, `created_at` FROM `showings`
ON CONFLICT (`aggregate_type`, `aggregate_id`) DO NOTHING;--> statement-breakpoint
INSERT INTO `aggregate_registry` (`aggregate_type`, `aggregate_id`, `created_at`)
SELECT 'Reservation', `reservation_id`, `created_at` FROM `reservations`
ON CONFLICT (`aggregate_type`, `aggregate_id`) DO NOTHING;
