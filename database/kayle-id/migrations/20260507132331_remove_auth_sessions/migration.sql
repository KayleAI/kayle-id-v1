DROP TABLE "auth_sessions";--> statement-breakpoint
CREATE UNIQUE INDEX "auth_organizations_slug_uidx" ON "auth_organizations" ("slug");--> statement-breakpoint
CREATE INDEX "auth_two_factors_secret_idx" ON "auth_two_factors" ("secret");