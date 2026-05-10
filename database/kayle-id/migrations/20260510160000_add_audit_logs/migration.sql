-- ID-50: per-organization audit log surfaced to org owners/admins.
--
-- Append-only table that records every state-changing action against an
-- organization (sessions, settings, members, API keys, webhooks). Distinct
-- from `events` because audit rows are never fanned out to webhooks and
-- cover a broader event surface (member role changes, key creation, etc.).

CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"actor_type" text NOT NULL,
	"event" text NOT NULL,
	"target_id" text,
	"target_type" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "audit_logs_organization_id_auth_organizations_id_fk"
		FOREIGN KEY ("organization_id")
		REFERENCES "auth_organizations" ("id")
		ON DELETE CASCADE,
	CONSTRAINT "audit_logs_actor_user_id_auth_users_id_fk"
		FOREIGN KEY ("actor_user_id")
		REFERENCES "auth_users" ("id")
		ON DELETE SET NULL,
	CONSTRAINT "audit_logs_actor_type_check"
		CHECK ("actor_type" IN ('user', 'system'))
);
--> statement-breakpoint
CREATE INDEX "audit_logs_org_created_idx"
	ON "audit_logs" ("organization_id", "created_at");
--> statement-breakpoint
CREATE INDEX "audit_logs_org_event_idx"
	ON "audit_logs" ("organization_id", "event");
--> statement-breakpoint
CREATE INDEX "audit_logs_actor_user_idx"
	ON "audit_logs" ("actor_user_id");
