CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `accounts_userId_idx` ON `accounts` (`user_id`);--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`inviter_id` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inviter_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invitations_organizationId_idx` ON `invitations` (`organization_id`);--> statement-breakpoint
CREATE INDEX `invitations_email_idx` ON `invitations` (`email`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `members_organizationId_idx` ON `members` (`organization_id`);--> statement-breakpoint
CREATE INDEX `members_userId_idx` ON `members` (`user_id`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo` text,
	`created_at` integer NOT NULL,
	`metadata` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_slug_unique` ON `organizations` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_slug_uidx` ON `organizations` (`slug`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`active_organization_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
CREATE INDEX `sessions_userId_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verifications_identifier_idx` ON `verifications` (`identifier`);--> statement-breakpoint
CREATE TABLE `organization_connect_accounts` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`stripe_connect_account_id` text NOT NULL,
	`charges_enabled` integer DEFAULT false NOT NULL,
	`payouts_enabled` integer DEFAULT false NOT NULL,
	`details_submitted` integer DEFAULT false NOT NULL,
	`onboarding_status` text DEFAULT 'pending' NOT NULL,
	`default_currency` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_connect_accounts_stripe_connect_account_id_unique` ON `organization_connect_accounts` (`stripe_connect_account_id`);--> statement-breakpoint
CREATE INDEX `connect_accounts_stripe_idx` ON `organization_connect_accounts` (`stripe_connect_account_id`);--> statement-breakpoint
CREATE TABLE `reconciliation_exceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`reservation_id` text NOT NULL,
	`payment_intent_id` text,
	`kind` text NOT NULL,
	`expected_amount` integer,
	`actual_amount` integer,
	`currency` text,
	`detail` text,
	`status` text DEFAULT 'open' NOT NULL,
	`detected_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE INDEX `reconciliation_exceptions_reservation_idx` ON `reconciliation_exceptions` (`reservation_id`);--> statement-breakpoint
CREATE INDEX `reconciliation_exceptions_status_idx` ON `reconciliation_exceptions` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `reconciliation_exceptions_open_uidx` ON `reconciliation_exceptions` (`reservation_id`,`kind`) WHERE "reconciliation_exceptions"."status" = 'open';--> statement-breakpoint
CREATE TABLE `stripe_webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`payment_intent_id` text,
	`reservation_id` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`received_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`processed_at` integer
);
--> statement-breakpoint
CREATE INDEX `stripe_webhook_events_pi_idx` ON `stripe_webhook_events` (`payment_intent_id`);--> statement-breakpoint
CREATE INDEX `stripe_webhook_events_status_idx` ON `stripe_webhook_events` (`status`);--> statement-breakpoint
CREATE TABLE `user_payment_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`stripe_customer_id` text NOT NULL,
	`default_payment_method_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_payment_profiles_stripe_customer_id_unique` ON `user_payment_profiles` (`stripe_customer_id`);--> statement-breakpoint
CREATE INDEX `user_payment_profiles_customer_idx` ON `user_payment_profiles` (`stripe_customer_id`);--> statement-breakpoint
CREATE TABLE `positions` (
	`projection` text NOT NULL,
	`aggregate_id` text NOT NULL,
	`last_seq` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`projection`, `aggregate_id`)
);
--> statement-breakpoint
CREATE TABLE `reservations` (
	`reservation_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`showing_id` text NOT NULL,
	`organization_id` text,
	`status` text DEFAULT 'initiated' NOT NULL,
	`seat_ids` text NOT NULL,
	`quantity` integer NOT NULL,
	`subtotal_amount` integer NOT NULL,
	`application_fee_amount` integer DEFAULT 0 NOT NULL,
	`total_amount` integer NOT NULL,
	`currency` text NOT NULL,
	`line_items` text,
	`payment_intent_id` text,
	`hold_expires_at` integer,
	`authorized_at` integer,
	`confirmed_at` integer,
	`last_seq` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reservations_payment_intent_id_unique` ON `reservations` (`payment_intent_id`);--> statement-breakpoint
CREATE INDEX `reservations_user_idx` ON `reservations` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `reservations_showing_idx` ON `reservations` (`showing_id`);--> statement-breakpoint
CREATE INDEX `reservations_organization_idx` ON `reservations` (`organization_id`);--> statement-breakpoint
CREATE INDEX `reservations_status_idx` ON `reservations` (`status`);--> statement-breakpoint
CREATE TABLE `sales_dashboards` (
	`showing_id` text PRIMARY KEY NOT NULL,
	`organization_id` text,
	`total_seats` integer DEFAULT 0 NOT NULL,
	`available_seats` integer DEFAULT 0 NOT NULL,
	`held_seats` integer DEFAULT 0 NOT NULL,
	`booked_seats` integer DEFAULT 0 NOT NULL,
	`hold_count` integer DEFAULT 0 NOT NULL,
	`booked_count` integer DEFAULT 0 NOT NULL,
	`gross_amount` integer DEFAULT 0 NOT NULL,
	`fee_amount` integer DEFAULT 0 NOT NULL,
	`currency` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sales_dashboards_organization_idx` ON `sales_dashboards` (`organization_id`);--> statement-breakpoint
CREATE TABLE `seat_availabilities` (
	`showing_id` text NOT NULL,
	`seat_id` text NOT NULL,
	`section` text,
	`row_label` text,
	`seat_number` text,
	`ticket_type_id` text,
	`status` text DEFAULT 'available' NOT NULL,
	`held_by_reservation_id` text,
	`booked_by_reservation_id` text,
	`hold_expires_at` integer,
	`last_seq` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`showing_id`, `seat_id`),
	FOREIGN KEY (`showing_id`) REFERENCES `showings`(`showing_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `seat_availabilities_status_idx` ON `seat_availabilities` (`showing_id`,`status`);--> statement-breakpoint
CREATE TABLE `showings` (
	`showing_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`title` text NOT NULL,
	`venue` text,
	`starts_at` integer NOT NULL,
	`sales_start_at` integer,
	`sales_end_at` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`currency` text NOT NULL,
	`total_seats` integer DEFAULT 0 NOT NULL,
	`last_seq` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `showings_organization_id_idx` ON `showings` (`organization_id`);--> statement-breakpoint
CREATE INDEX `showings_status_starts_idx` ON `showings` (`status`,`starts_at`);--> statement-breakpoint
CREATE TABLE `ticket_types` (
	`showing_id` text NOT NULL,
	`ticket_type_id` text NOT NULL,
	`name` text NOT NULL,
	`unit_amount` integer NOT NULL,
	`currency` text NOT NULL,
	`capacity` integer,
	`last_seq` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`showing_id`, `ticket_type_id`),
	FOREIGN KEY (`showing_id`) REFERENCES `showings`(`showing_id`) ON UPDATE no action ON DELETE cascade
);
