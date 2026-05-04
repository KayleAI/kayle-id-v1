-- Add two-factor authentication support: a per-user flag on auth_users plus a
-- separate auth_two_factors row that holds the encrypted TOTP secret and the
-- encrypted backup codes. A user can only have one active 2FA enrolment, so
-- userId is unique; the better-auth twoFactor plugin enforces this at the
-- application layer by deleting prior rows during enable.
ALTER TABLE "auth_users"
ADD COLUMN "two_factor_enabled" boolean NOT NULL DEFAULT false;--> statement-breakpoint

CREATE TABLE "auth_two_factors" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"verified" boolean NOT NULL DEFAULT true,
	"created_at" timestamp NOT NULL DEFAULT now(),
	"updated_at" timestamp NOT NULL DEFAULT now(),
	CONSTRAINT "auth_two_factors_user_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "auth_users"("id") ON DELETE CASCADE
);--> statement-breakpoint

CREATE INDEX "auth_two_factors_userId_idx" ON "auth_two_factors" ("user_id");
