-- ID-48 follow-up: bring back the global-unique-active-apex partial index.
-- An earlier migration (20260510130000_drop_active_apex_unique) dropped this
-- to avoid blocking parallel test fixtures that all seeded the same
-- example.com row. The application now collaborates with the constraint via
-- an explicit "takeover" handshake — when org B verifies an apex already
-- active for org A, the API downgrades A's row in the same transaction
-- before inserting B's, so the constraint is never observably violated.
-- Tests have been switched to per-org-unique apex domains so they no
-- longer collide.

DROP INDEX IF EXISTS "auth_org_verified_domains_active_apex_uidx";
--> statement-breakpoint
-- Defensive dedup: if any environment accumulated duplicate active rows
-- while the constraint was off, downgrade the older ones so the partial
-- unique index can be created. Keeps the most-recently-verified row as
-- the active owner — same arbitration rule the takeover handshake uses
-- when handing off going forward.
WITH ranked_active AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "apex_domain"
			ORDER BY "verified_at" DESC, "id" DESC
		) AS "active_rank"
	FROM "auth_organization_verified_domains"
	WHERE "downgraded_at" IS NULL
)
UPDATE "auth_organization_verified_domains"
SET "downgraded_at" = now(), "updated_at" = now()
WHERE "id" IN (
	SELECT "id" FROM ranked_active WHERE "active_rank" > 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX "auth_org_verified_domains_active_apex_uidx"
	ON "auth_organization_verified_domains" ("apex_domain")
	WHERE "downgraded_at" IS NULL;
