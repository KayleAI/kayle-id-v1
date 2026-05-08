CREATE TABLE "mobile_attest_keys" (
	"key_id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"public_key_cose" text,
	"counter" integer DEFAULT 0 NOT NULL,
	"receipt" text,
	"receipt_refreshed_at" timestamp,
	"risk_metric" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mobile_attest_keys" ADD CONSTRAINT "mobile_attest_keys_provider_check" CHECK ("provider" IN ('ios_app_attest', 'android_play_integrity'));
--> statement-breakpoint
CREATE INDEX "mobile_attest_keys_receipt_refresh_idx" ON "mobile_attest_keys" ("receipt_refreshed_at");
--> statement-breakpoint
CREATE INDEX "mobile_attest_keys_provider_idx" ON "mobile_attest_keys" ("provider");
--> statement-breakpoint
ALTER TABLE "verification_attempts" ADD COLUMN "mobile_attest_key_id" text;
--> statement-breakpoint
ALTER TABLE "verification_attempts" ADD CONSTRAINT "verification_attempts_mobile_attest_key_id_fkey" FOREIGN KEY ("mobile_attest_key_id") REFERENCES "mobile_attest_keys"("key_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "verif_attempts_mobile_attest_key_idx" ON "verification_attempts" ("mobile_attest_key_id");
--> statement-breakpoint
ALTER TABLE "verification_attempts" DROP CONSTRAINT IF EXISTS "verif_attempts_failure_code_check";
--> statement-breakpoint
ALTER TABLE "verification_attempts" ADD CONSTRAINT "verif_attempts_failure_code_check" CHECK (
	"failure_code" IS NULL
	OR "failure_code" IN (
		'session_expired',
		'session_cancelled',
		'passport_authenticity_failed',
		'passport_active_authentication_failed',
		'passport_chip_authentication_failed',
		'passport_anti_cloning_attestation_failed',
		'selfie_face_mismatch'
	)
);
