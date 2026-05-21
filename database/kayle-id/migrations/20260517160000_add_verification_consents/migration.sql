ALTER TABLE "verification_attempts"
ADD COLUMN "selected_share_field_keys" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint

CREATE TABLE "verification_consents" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "verification_session_id" text NOT NULL,
  "verification_attempt_id" text,
  "consented_at" timestamp DEFAULT now() NOT NULL,
  "consent_ui_version" integer NOT NULL,
  "terms_version" text NOT NULL,
  "privacy_notice_version" text NOT NULL,
  "share_contract_hash" text NOT NULL,
  "requested_claim_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "selected_claim_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "required_claim_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "document_processing_consent" boolean DEFAULT false NOT NULL,
  "biometric_consent" boolean DEFAULT false NOT NULL,
  "share_claims_consent" boolean DEFAULT false NOT NULL,
  "terms_acknowledged" boolean DEFAULT false NOT NULL,
  "privacy_notice_acknowledged" boolean DEFAULT false NOT NULL,
  "rp_name" text NOT NULL,
  "controller_name" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "verification_consents"
ADD CONSTRAINT "verification_consents_organization_id_auth_organizations_id_fk"
FOREIGN KEY ("organization_id") REFERENCES "auth_organizations"("id")
ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "verification_consents"
ADD CONSTRAINT "verification_consents_verification_session_id_verification_sessions_id_fk"
FOREIGN KEY ("verification_session_id") REFERENCES "verification_sessions"("id")
ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "verification_consents"
ADD CONSTRAINT "verification_consents_verification_attempt_id_verification_attempts_id_fk"
FOREIGN KEY ("verification_attempt_id") REFERENCES "verification_attempts"("id")
ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "verif_consents_session_created_idx"
ON "verification_consents" ("verification_session_id", "created_at");--> statement-breakpoint

CREATE INDEX "verif_consents_attempt_idx"
ON "verification_consents" ("verification_attempt_id");--> statement-breakpoint

CREATE INDEX "verif_consents_org_created_idx"
ON "verification_consents" ("organization_id", "created_at");
