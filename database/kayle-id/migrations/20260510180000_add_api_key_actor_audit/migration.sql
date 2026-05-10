-- API keys are first-class actors in audit logs. Previously a programmatic
-- call (e.g. webhook endpoint create via API key) was attributed to the
-- generic `system` actor, with the key id stuffed into metadata as a fallback.
-- That conflated cron/background work with intentional programmatic calls.
--
-- This migration:
--   1. Adds a typed `actor_api_key_id` column with a FK + ON DELETE SET NULL.
--   2. Replaces the `actor_type` check constraint to admit `api_key` *first*,
--      so the subsequent UPDATEs are allowed.
--   3. Backfills `actor_api_key_id` from the JSONB metadata for rows written
--      during the first iteration of the audit-log feature, and promotes
--      those rows from `system` to `api_key`.
--   4. Drops the now-redundant `metadata.actor_api_key_id` key.
--
-- The audit row must outlive the API key, hence ON DELETE SET NULL: when a
-- key is rotated/deleted the historical attribution becomes "API key
-- (deleted)" rather than disappearing.

ALTER TABLE "audit_logs"
	ADD COLUMN "actor_api_key_id" uuid;
--> statement-breakpoint
ALTER TABLE "audit_logs"
	ADD CONSTRAINT "audit_logs_actor_api_key_id_api_keys_id_fk"
	FOREIGN KEY ("actor_api_key_id") REFERENCES "api_keys" ("id")
	ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "audit_logs_actor_api_key_idx"
	ON "audit_logs" ("actor_api_key_id");
--> statement-breakpoint

-- Replace the actor_type check constraint to admit `api_key` before any
-- UPDATEs that would otherwise violate the old constraint.
ALTER TABLE "audit_logs"
	DROP CONSTRAINT "audit_logs_actor_type_check";
--> statement-breakpoint
ALTER TABLE "audit_logs"
	ADD CONSTRAINT "audit_logs_actor_type_check"
	CHECK ("actor_type" IN ('user', 'system', 'api_key'));
--> statement-breakpoint

-- Backfill from metadata.actor_api_key_id where present, joining api_keys
-- to ensure we don't introduce a dangling FK reference (e.g., the recorded
-- key may have been deleted between the audit-row write and this migration).
UPDATE "audit_logs" AS "al"
SET "actor_api_key_id" = "ak"."id"
FROM "api_keys" AS "ak"
WHERE "al"."metadata" ? 'actor_api_key_id'
	AND "al"."metadata"->>'actor_api_key_id' = "ak"."id"::text;
--> statement-breakpoint

-- Promote rows that had a recoverable api_key id from `system` → `api_key`.
UPDATE "audit_logs"
SET "actor_type" = 'api_key'
WHERE "actor_api_key_id" IS NOT NULL;
--> statement-breakpoint

-- Drop the metadata fallback so future readers don't see two sources of truth.
UPDATE "audit_logs"
SET "metadata" = "metadata" - 'actor_api_key_id'
WHERE "metadata" ? 'actor_api_key_id';
