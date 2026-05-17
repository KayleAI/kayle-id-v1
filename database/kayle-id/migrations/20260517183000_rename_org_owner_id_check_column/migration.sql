ALTER TABLE "auth_organizations" RENAME COLUMN "verified_at" TO "owner_id_checked_at";--> statement-breakpoint
ALTER INDEX "auth_organizations_verified_at_idx" RENAME TO "auth_organizations_owner_id_checked_at_idx";--> statement-breakpoint
