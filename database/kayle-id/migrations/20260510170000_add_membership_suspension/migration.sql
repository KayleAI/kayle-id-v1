-- Membership suspension: members can no longer be hard-deleted through the
-- user-facing remove/leave flows. Setting `suspended_at` blocks access while
-- preserving the row so audit-log filtering by actor stays meaningful.
ALTER TABLE "auth_organization_members"
	ADD COLUMN "suspended_at" timestamp;
--> statement-breakpoint
ALTER TABLE "auth_organization_members"
	ADD COLUMN "suspended_by" uuid;
--> statement-breakpoint
ALTER TABLE "auth_organization_members"
	ADD CONSTRAINT "auth_organization_members_suspended_by_auth_users_id_fk"
	FOREIGN KEY ("suspended_by") REFERENCES "auth_users" ("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX "auth_organization_members_suspended_at_idx"
	ON "auth_organization_members" ("suspended_at");
--> statement-breakpoint
-- Active memberships are unique on (org, user). Suspended rows are excluded
-- so a previously-suspended user can be re-added (either by reinstating their
-- existing row or by inserting a fresh active one alongside the suspended
-- audit-log shadow).
CREATE UNIQUE INDEX "auth_org_members_active_uidx"
	ON "auth_organization_members" ("organization_id", "user_id")
	WHERE "suspended_at" IS NULL;
