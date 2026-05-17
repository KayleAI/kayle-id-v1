CREATE TABLE "auth_organization_rp_terms_acceptances" (
  "id" uuid DEFAULT pg_catalog.gen_random_uuid() PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "terms_version" text NOT NULL,
  "terms_hash" text NOT NULL,
  "jurisdiction" text NOT NULL,
  "accepted_by" uuid,
  "accepted_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "auth_organization_rp_terms_acceptances"
ADD CONSTRAINT "auth_organization_rp_terms_acceptances_organization_id_auth_organizations_id_fk"
FOREIGN KEY ("organization_id") REFERENCES "auth_organizations"("id")
ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "auth_organization_rp_terms_acceptances"
ADD CONSTRAINT "auth_organization_rp_terms_acceptances_accepted_by_auth_users_id_fk"
FOREIGN KEY ("accepted_by") REFERENCES "auth_users"("id")
ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "auth_org_rp_terms_current_uidx"
ON "auth_organization_rp_terms_acceptances" (
  "organization_id",
  "terms_version",
  "terms_hash",
  "jurisdiction"
);--> statement-breakpoint

CREATE INDEX "auth_org_rp_terms_org_accepted_at_idx"
ON "auth_organization_rp_terms_acceptances" ("organization_id", "accepted_at");
