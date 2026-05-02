ALTER TABLE "api_keys" ALTER COLUMN "permissions" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "verification_sessions" ADD COLUMN "cancel_token_hash" text;--> statement-breakpoint
ALTER TABLE "verification_sessions" ADD COLUMN "cancel_token_consumed_at" timestamp;