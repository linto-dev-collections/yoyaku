CREATE TABLE `events` (
	`seq` integer PRIMARY KEY NOT NULL,
	`aggregate_id` text NOT NULL,
	`aggregate_type` text NOT NULL,
	`event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload` text NOT NULL,
	`metadata` text NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`occurred_at` integer NOT NULL,
	`recorded_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_event_id_unique` ON `events` (`event_id`);--> statement-breakpoint
CREATE INDEX `events_type_idx` ON `events` (`event_type`);--> statement-breakpoint
CREATE INDEX `events_occurred_idx` ON `events` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`key` text PRIMARY KEY NOT NULL,
	`command_type` text NOT NULL,
	`actor` text NOT NULL,
	`request_hash` text NOT NULL,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`first_seq` integer,
	`last_seq` integer,
	`response_json` text,
	`error_code` text,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idempotency_keys_expires_idx` ON `idempotency_keys` (`expires_at`);--> statement-breakpoint
CREATE TABLE `outboxes` (
	`seq` integer PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`aggregate_id` text NOT NULL,
	`aggregate_type` text NOT NULL,
	`event_type` text NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`payload` text NOT NULL,
	`metadata` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`published_at` integer
);
--> statement-breakpoint
CREATE INDEX `outboxes_status_idx` ON `outboxes` (`status`,`seq`);--> statement-breakpoint
CREATE TABLE `snapshots` (
	`seq` integer NOT NULL,
	`part` text DEFAULT 'full' NOT NULL,
	`aggregate_id` text NOT NULL,
	`state` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`seq`, `part`)
);
--> statement-breakpoint
CREATE TABLE `streams` (
	`aggregate_id` text PRIMARY KEY NOT NULL,
	`aggregate_type` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`last_snapshot_seq` integer,
	`last_published_seq` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
