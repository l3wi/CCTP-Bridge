CREATE TABLE `bridge_burn_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`burn_hash` text NOT NULL,
	`source_chain_id` text NOT NULL,
	`target_chain_id` text NOT NULL,
	`transfer_type` text NOT NULL,
	`amount_atomic` integer NOT NULL,
	`app_fee_atomic` integer NOT NULL,
	`app_fee_bps` integer,
	`circle_fee_atomic` integer NOT NULL,
	`submitted_at` integer NOT NULL,
	`recorded_at` integer NOT NULL,
	CONSTRAINT "bridge_burn_submissions_transfer_type_check" CHECK("bridge_burn_submissions"."transfer_type" in ('fast', 'standard')),
	CONSTRAINT "bridge_burn_submissions_amounts_non_negative_check" CHECK("bridge_burn_submissions"."amount_atomic" >= 0 and "bridge_burn_submissions"."app_fee_atomic" >= 0 and "bridge_burn_submissions"."circle_fee_atomic" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bridge_burn_submissions_chain_hash_idx` ON `bridge_burn_submissions` (`source_chain_id`,`burn_hash`);--> statement-breakpoint
CREATE INDEX `bridge_burn_submissions_submitted_at_idx` ON `bridge_burn_submissions` (`submitted_at`);--> statement-breakpoint
CREATE INDEX `bridge_burn_submissions_transfer_type_idx` ON `bridge_burn_submissions` (`transfer_type`);--> statement-breakpoint
CREATE INDEX `bridge_burn_submissions_route_idx` ON `bridge_burn_submissions` (`source_chain_id`,`target_chain_id`);