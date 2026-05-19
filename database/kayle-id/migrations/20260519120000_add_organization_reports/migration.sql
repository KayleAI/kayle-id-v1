CREATE TABLE "organization_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"reported_organization_id" uuid NOT NULL,
	"verification_session_id" text,
	"reason" text NOT NULL,
	"details" text,
	"status" text DEFAULT 'open' NOT NULL,
	"reporter_context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"admin_note" text,
	"resolved_at" timestamp,
	"resolved_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_reports_reason_check" CHECK (
		"reason" IN (
			'impersonation',
			'deceptive_use',
			'privacy_concern',
			'discrimination_or_eligibility_concern',
			'missing_fallback_or_appeal',
			'other'
		)
	),
	CONSTRAINT "organization_reports_status_check" CHECK (
		"status" IN ('open', 'investigating', 'resolved', 'dismissed')
	)
);

ALTER TABLE "organization_reports"
ADD CONSTRAINT "organization_reports_reported_organization_id_auth_organizations_id_fk"
FOREIGN KEY ("reported_organization_id") REFERENCES "auth_organizations"("id")
ON DELETE cascade ON UPDATE no action;

ALTER TABLE "organization_reports"
ADD CONSTRAINT "organization_reports_verification_session_id_verification_sessions_id_fk"
FOREIGN KEY ("verification_session_id") REFERENCES "verification_sessions"("id")
ON DELETE set null ON UPDATE no action;

ALTER TABLE "organization_reports"
ADD CONSTRAINT "organization_reports_resolved_by_user_id_auth_users_id_fk"
FOREIGN KEY ("resolved_by_user_id") REFERENCES "auth_users"("id")
ON DELETE set null ON UPDATE no action;

CREATE INDEX "organization_reports_status_created_idx"
ON "organization_reports" ("status", "created_at");

CREATE INDEX "organization_reports_reason_idx"
ON "organization_reports" ("reason");

CREATE INDEX "organization_reports_reported_org_idx"
ON "organization_reports" ("reported_organization_id", "created_at");

CREATE INDEX "organization_reports_session_idx"
ON "organization_reports" ("verification_session_id");
