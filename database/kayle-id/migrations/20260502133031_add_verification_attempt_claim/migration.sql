ALTER TABLE "verification_attempts" ADD COLUMN "claimed_by_connection_id" text;--> statement-breakpoint
ALTER TABLE "verification_attempts" ADD COLUMN "claimed_at" timestamp;