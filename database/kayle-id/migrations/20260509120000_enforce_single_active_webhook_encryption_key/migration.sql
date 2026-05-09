-- Webhook delivery looks up one active encryption key per endpoint. Collapse
-- any historical duplicates before enforcing that invariant in Postgres.
WITH ranked_active_keys AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "webhook_endpoint_id"
			ORDER BY "created_at" DESC, "id" DESC
		) AS "active_rank"
	FROM "webhook_encryption_keys"
	WHERE "is_active" = true
)
UPDATE "webhook_encryption_keys"
SET
	"is_active" = false,
	"disabled_at" = COALESCE("disabled_at", now()),
	"updated_at" = now()
WHERE "id" IN (
	SELECT "id"
	FROM ranked_active_keys
	WHERE "active_rank" > 1
);

CREATE UNIQUE INDEX "webhook_encryption_keys_one_active_per_endpoint_uidx"
	ON "webhook_encryption_keys" ("webhook_endpoint_id")
	WHERE "is_active" = true;
