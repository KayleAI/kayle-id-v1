ALTER TABLE "webhook_endpoints" ADD COLUMN "labels" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "verification_sessions" ADD COLUMN "webhook_endpoint_ids" jsonb;
