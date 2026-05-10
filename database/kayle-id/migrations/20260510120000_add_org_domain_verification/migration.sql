-- Tier-1 anti-phishing (Linear ID-48): organizations can prove control of an
-- apex domain via DNS TXT or RFC 2142 email OTP. The verified apex becomes
-- the trust anchor in the verify flow and gates redirect-URI acceptance.

CREATE TABLE "auth_organization_verified_domains" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"apex_domain" text NOT NULL,
	"verified_at" timestamp NOT NULL,
	"verified_via" text NOT NULL,
	"verified_by" uuid,
	"recheck_token" text,
	"last_checked_at" timestamp,
	"consecutive_failed_checks" integer DEFAULT 0 NOT NULL,
	"downgraded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_organization_verified_domains"
	ADD CONSTRAINT "auth_organization_verified_domains_organization_id_fkey"
	FOREIGN KEY ("organization_id") REFERENCES "public"."auth_organizations"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "auth_organization_verified_domains"
	ADD CONSTRAINT "auth_organization_verified_domains_verified_by_fkey"
	FOREIGN KEY ("verified_by") REFERENCES "public"."auth_users"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "auth_organization_verified_domains"
	ADD CONSTRAINT "auth_organization_verified_domains_verified_via_check"
	CHECK ("verified_via" IN ('dns_txt', 'email_otp'));
--> statement-breakpoint
CREATE UNIQUE INDEX "auth_org_verified_domains_org_apex_uidx"
	ON "auth_organization_verified_domains" ("organization_id", "apex_domain");
--> statement-breakpoint
-- Lookup index for "which org claims this apex?" — used by the verify flow
-- payload and rejected-redirect logging. Not unique: ownership transfers
-- and legitimate multi-tenancy cases (subsidiaries, M&A) may legitimately
-- have two orgs verified for the same apex; we don't litigate those here.
CREATE INDEX "auth_org_verified_domains_apex_idx"
	ON "auth_organization_verified_domains" ("apex_domain");
--> statement-breakpoint
CREATE INDEX "auth_org_verified_domains_org_idx"
	ON "auth_organization_verified_domains" ("organization_id");
--> statement-breakpoint
CREATE INDEX "auth_org_verified_domains_downgraded_idx"
	ON "auth_organization_verified_domains" ("downgraded_at");
--> statement-breakpoint

CREATE TABLE "auth_organization_domain_challenges" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"apex_domain" text NOT NULL,
	"method" text NOT NULL,
	"token" text NOT NULL,
	"email_address" text,
	"expires_at" timestamp NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "auth_organization_domain_challenges"
	ADD CONSTRAINT "auth_organization_domain_challenges_organization_id_fkey"
	FOREIGN KEY ("organization_id") REFERENCES "public"."auth_organizations"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "auth_organization_domain_challenges"
	ADD CONSTRAINT "auth_organization_domain_challenges_created_by_fkey"
	FOREIGN KEY ("created_by") REFERENCES "public"."auth_users"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "auth_organization_domain_challenges"
	ADD CONSTRAINT "auth_organization_domain_challenges_method_check"
	CHECK ("method" IN ('dns_txt', 'email_otp'));
--> statement-breakpoint
CREATE INDEX "auth_org_domain_challenges_org_apex_method_idx"
	ON "auth_organization_domain_challenges" ("organization_id", "apex_domain", "method");
--> statement-breakpoint
CREATE INDEX "auth_org_domain_challenges_expires_idx"
	ON "auth_organization_domain_challenges" ("expires_at");
--> statement-breakpoint

CREATE TABLE "auth_organization_redirect_uris" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"verified_domain_id" uuid NOT NULL,
	"pattern" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "auth_organization_redirect_uris"
	ADD CONSTRAINT "auth_organization_redirect_uris_organization_id_fkey"
	FOREIGN KEY ("organization_id") REFERENCES "public"."auth_organizations"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "auth_organization_redirect_uris"
	ADD CONSTRAINT "auth_organization_redirect_uris_verified_domain_id_fkey"
	FOREIGN KEY ("verified_domain_id") REFERENCES "public"."auth_organization_verified_domains"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "auth_organization_redirect_uris"
	ADD CONSTRAINT "auth_organization_redirect_uris_created_by_fkey"
	FOREIGN KEY ("created_by") REFERENCES "public"."auth_users"("id") ON DELETE set null;
--> statement-breakpoint
CREATE UNIQUE INDEX "auth_org_redirect_uris_domain_pattern_uidx"
	ON "auth_organization_redirect_uris" ("verified_domain_id", "pattern");
--> statement-breakpoint
CREATE INDEX "auth_org_redirect_uris_org_idx"
	ON "auth_organization_redirect_uris" ("organization_id");
