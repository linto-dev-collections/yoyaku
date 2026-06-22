ALTER TABLE `showings` ADD `risk_tier` text DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE `showings` ADD `max_seats_per_user` integer DEFAULT 4 NOT NULL;