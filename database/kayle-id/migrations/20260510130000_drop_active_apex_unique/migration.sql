-- ID-48 follow-up: per-(org, apex) uniqueness is sufficient. The
-- original migration also added a partial UNIQUE index that prevented two
-- different orgs from holding an active verification for the same apex,
-- but this constraint litigates legitimate cross-org cases (subsidiaries,
-- M&A, ownership transfers) at the DB layer rather than at policy. Drop
-- it; the (org, apex) unique already prevents per-org duplicates.

DROP INDEX IF EXISTS "auth_org_verified_domains_active_apex_uidx";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_org_verified_domains_apex_idx"
	ON "auth_organization_verified_domains" ("apex_domain");
