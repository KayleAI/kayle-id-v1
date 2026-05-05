DROP INDEX "events_org_env_created_idx";--> statement-breakpoint
DROP INDEX "verif_sessions_org_env_idx";--> statement-breakpoint
DROP INDEX "wh_endpoints_org_env_idx";--> statement-breakpoint
ALTER TABLE "api_keys" DROP COLUMN "environment";--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "environment";--> statement-breakpoint
ALTER TABLE "verification_sessions" DROP COLUMN "environment";--> statement-breakpoint
ALTER TABLE "webhook_endpoints" DROP COLUMN "environment";--> statement-breakpoint
CREATE INDEX "events_org_created_idx" ON "events" ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "verif_sessions_org_idx" ON "verification_sessions" ("organization_id");--> statement-breakpoint
CREATE INDEX "wh_endpoints_org_idx" ON "webhook_endpoints" ("organization_id");