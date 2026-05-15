-- Add `liveness_failed` as a valid failure code for verification attempts.
-- Emitted when the new head-movement liveness check rejects the recorded
-- video before the face match step runs (pose sequence mismatch, no face
-- detected, yaw timeline unstable). failure_code is stored as text + CHECK,
-- so we drop the existing constraint and re-add it with the wider set.
ALTER TABLE "verification_attempts"
	DROP CONSTRAINT IF EXISTS "verif_attempts_failure_code_check";

ALTER TABLE "verification_attempts"
	ADD CONSTRAINT "verif_attempts_failure_code_check"
	CHECK (
		"failure_code" IS NULL
		OR "failure_code" IN (
			'session_expired',
			'session_cancelled',
			'document_authenticity_failed',
			'document_active_authentication_failed',
			'document_chip_authentication_failed',
			'document_anti_cloning_attestation_failed',
			'liveness_failed',
			'selfie_face_mismatch'
		)
	);
