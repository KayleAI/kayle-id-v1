CREATE TABLE "org_verification_records" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
	"organization_id" uuid NOT NULL,
	"dedup_hash" text NOT NULL,
	"pepper_version" integer DEFAULT 1 NOT NULL,
	"document_type" text NOT NULL,
	"issuing_country" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_organizations" ADD COLUMN "verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "auth_organizations" ADD COLUMN "business_type" text;--> statement-breakpoint
ALTER TABLE "auth_organizations" ADD COLUMN "business_jurisdiction" text;--> statement-breakpoint
ALTER TABLE "auth_organizations" ADD COLUMN "business_name" text;--> statement-breakpoint
ALTER TABLE "auth_organizations" ADD COLUMN "business_registration_number" text;--> statement-breakpoint
ALTER TABLE "auth_organizations" ADD COLUMN "verification_terms_accepted_at" timestamp;--> statement-breakpoint
ALTER TABLE "auth_organizations" ADD COLUMN "verification_terms_accepted_by" uuid;--> statement-breakpoint
ALTER TABLE "verification_sessions" ADD COLUMN "owner_verification_org_id" uuid;--> statement-breakpoint
ALTER TABLE "verification_sessions" ADD COLUMN "is_age_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "auth_organizations_verified_at_idx" ON "auth_organizations" ("verified_at");--> statement-breakpoint
CREATE INDEX "org_verification_records_dedup_hash_idx" ON "org_verification_records" ("dedup_hash");--> statement-breakpoint
CREATE INDEX "org_verification_records_org_created_at_idx" ON "org_verification_records" ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "verif_sessions_org_age_only_created_at_idx" ON "verification_sessions" ("organization_id","is_age_only","created_at");--> statement-breakpoint
CREATE INDEX "verif_sessions_owner_verification_org_idx" ON "verification_sessions" ("owner_verification_org_id");--> statement-breakpoint
ALTER TABLE "auth_organizations" ADD CONSTRAINT "auth_organizations_OL5Tg4ixmG4P_fkey" FOREIGN KEY ("verification_terms_accepted_by") REFERENCES "auth_users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "org_verification_records" ADD CONSTRAINT "org_verification_records_UPu1EozJs6gR_fkey" FOREIGN KEY ("organization_id") REFERENCES "auth_organizations"("id") ON DELETE CASCADE;