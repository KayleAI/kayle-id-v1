-- Fold verification_attempts into verification_sessions.
--
-- Per-session retries are replaced with per-check retries: NFC ×3, liveness ×3,
-- MRZ unlimited. The verification_attempts table is dropped after the latest
-- row per session is copied onto the session row. The session status enum
-- gains `succeeded` and `failed` (replacing the derived `completed`).
--
-- This is a ONE-WAY migration. nfc_tries_used / liveness_tries_used cannot be
-- reconstructed from history; backfilled rows start at 0. Historical events
-- rows are not rewritten (append-only audit trail; old deliveries are already
-- in flight).

ALTER TABLE "verification_sessions"
	ADD COLUMN "failure_code" text,
	ADD COLUMN "nfc_tries_used" integer NOT NULL DEFAULT 0,
	ADD COLUMN "liveness_tries_used" integer NOT NULL DEFAULT 0,
	ADD COLUMN "risk_score" real NOT NULL DEFAULT 0,
	ADD COLUMN "selected_share_field_keys" jsonb NOT NULL DEFAULT '[]'::jsonb,
	ADD COLUMN "current_phase" text,
	ADD COLUMN "phase_updated_at" timestamp,
	ADD COLUMN "mobile_write_token_seed" text,
	ADD COLUMN "mobile_write_token_hash" text,
	ADD COLUMN "mobile_write_token_issued_at" timestamp,
	ADD COLUMN "mobile_write_token_expires_at" timestamp,
	ADD COLUMN "mobile_write_token_consumed_at" timestamp,
	ADD COLUMN "mobile_hello_device_id_hash" text,
	ADD COLUMN "mobile_hello_app_version" text,
	ADD COLUMN "mobile_attest_key_id" text,
	ADD COLUMN "claimed_by_connection_id" text,
	ADD COLUMN "claimed_at" timestamp;
--> statement-breakpoint

WITH latest AS (
	SELECT DISTINCT ON (verification_session_id)
		verification_session_id,
		failure_code,
		risk_score,
		selected_share_field_keys,
		current_phase,
		phase_updated_at,
		mobile_write_token_seed,
		mobile_write_token_hash,
		mobile_write_token_issued_at,
		mobile_write_token_expires_at,
		mobile_write_token_consumed_at,
		mobile_hello_device_id_hash,
		mobile_hello_app_version,
		mobile_attest_key_id,
		claimed_by_connection_id,
		claimed_at
	FROM "verification_attempts"
	ORDER BY verification_session_id, created_at DESC
)
UPDATE "verification_sessions" s
SET failure_code = CASE
		WHEN latest.failure_code IN ('session_expired', 'session_cancelled') THEN NULL
		ELSE latest.failure_code
	END,
	risk_score = latest.risk_score,
	selected_share_field_keys = latest.selected_share_field_keys,
	current_phase = latest.current_phase,
	phase_updated_at = latest.phase_updated_at,
	mobile_write_token_seed = latest.mobile_write_token_seed,
	mobile_write_token_hash = latest.mobile_write_token_hash,
	mobile_write_token_issued_at = latest.mobile_write_token_issued_at,
	mobile_write_token_expires_at = latest.mobile_write_token_expires_at,
	mobile_write_token_consumed_at = latest.mobile_write_token_consumed_at,
	mobile_hello_device_id_hash = latest.mobile_hello_device_id_hash,
	mobile_hello_app_version = latest.mobile_hello_app_version,
	mobile_attest_key_id = latest.mobile_attest_key_id,
	claimed_by_connection_id = latest.claimed_by_connection_id,
	claimed_at = latest.claimed_at
FROM latest
WHERE latest.verification_session_id = s.id;
--> statement-breakpoint

UPDATE "verification_sessions" s
SET status = CASE
		WHEN s.status = 'completed' AND EXISTS (
			SELECT 1 FROM "verification_attempts" a
			WHERE a.verification_session_id = s.id AND a.status = 'succeeded'
		) THEN 'succeeded'
		WHEN s.status = 'completed' THEN 'failed'
		ELSE s.status
	END;
--> statement-breakpoint

ALTER TABLE "verification_sessions"
	ADD CONSTRAINT "verif_sessions_failure_code_check"
	CHECK (
		"failure_code" IS NULL
		OR "failure_code" IN (
			'document_authenticity_failed',
			'document_active_authentication_failed',
			'document_chip_authentication_failed',
			'document_anti_cloning_attestation_failed',
			'document_data_invalid',
			'liveness_failed',
			'selfie_face_mismatch'
		)
	);
--> statement-breakpoint

UPDATE "webhook_endpoints"
SET subscribed_event_types = (
	SELECT jsonb_agg(
		CASE elem::text
			WHEN '"verification.attempt.succeeded"' THEN to_jsonb('verification.session.succeeded'::text)
			WHEN '"verification.attempt.failed"'    THEN to_jsonb('verification.session.failed'::text)
			ELSE elem
		END
	)
	FROM jsonb_array_elements(subscribed_event_types) AS elem
)
WHERE subscribed_event_types::text LIKE '%verification.attempt.%';
--> statement-breakpoint

DROP INDEX IF EXISTS "verif_consents_attempt_idx";
--> statement-breakpoint
ALTER TABLE "verification_consents" DROP COLUMN IF EXISTS "verification_attempt_id";
--> statement-breakpoint

DROP TABLE "verification_attempts" CASCADE;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "verif_sessions_mobile_attest_key_idx"
	ON "verification_sessions" USING btree ("mobile_attest_key_id");
