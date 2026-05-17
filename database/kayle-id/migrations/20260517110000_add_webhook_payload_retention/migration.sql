ALTER TABLE "webhook_endpoints" ADD COLUMN "undelivered_payload_retention_hours" integer DEFAULT 72 NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_payload_retention_hours_check" CHECK ("undelivered_payload_retention_hours" IN (0, 24, 72, 168));--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "payload_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "payload_scrubbed_at" timestamp;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "payload_retention_reason" text;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_payload_retention_reason_check" CHECK ("payload_retention_reason" IS NULL OR "payload_retention_reason" IN ('pending_delivery', 'delivered', 'terminal_failure_retention', 'expired', 'no_active_key', 'jwe_creation_failed'));--> statement-breakpoint
CREATE INDEX "wh_deliveries_payload_expires_at_idx" ON "webhook_deliveries" ("payload_expires_at") WHERE "payload" IS NOT NULL AND "payload_expires_at" IS NOT NULL;--> statement-breakpoint
UPDATE "webhook_deliveries"
SET
	"payload_expires_at" = "created_at" + INTERVAL '7 days',
	"payload_retention_reason" = 'pending_delivery'
WHERE "payload" IS NOT NULL;--> statement-breakpoint
UPDATE "webhook_deliveries"
SET
	"payload_scrubbed_at" = COALESCE("updated_at", "created_at"),
	"payload_retention_reason" = COALESCE("payload_retention_reason", 'expired')
WHERE "payload" IS NULL;
