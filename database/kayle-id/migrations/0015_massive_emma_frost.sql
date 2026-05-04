ALTER TABLE "auth_organizations" ADD COLUMN "pending_deletion_at" timestamp;--> statement-breakpoint
ALTER TABLE "auth_organizations" ADD COLUMN "pending_deletion_requested_at" timestamp;--> statement-breakpoint
ALTER TABLE "auth_organizations" ADD COLUMN "pending_deletion_requested_by" uuid;--> statement-breakpoint
ALTER TABLE "auth_organizations" ADD CONSTRAINT "auth_organizations_pending_deletion_requested_by_auth_users_id_fk" FOREIGN KEY ("pending_deletion_requested_by") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_organizations_pending_deletion_at_idx" ON "auth_organizations" USING btree ("pending_deletion_at");