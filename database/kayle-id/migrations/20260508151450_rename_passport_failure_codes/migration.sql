-- Rename passport_* failure codes to document_* across existing rows and the
-- CHECK constraint. The verify pipeline is being generalised to handle TD1/TD2
-- ID cards in addition to TD3 passports, so failure codes are now phrased in
-- terms of the document. failure_code is stored as text + CHECK (not a Postgres
-- enum), so this is a single-pass rewrite — no ALTER TYPE needed.
ALTER TABLE "verification_attempts"
	DROP CONSTRAINT IF EXISTS "verif_attempts_failure_code_check";

UPDATE "verification_attempts"
SET "failure_code" = CASE "failure_code"
	WHEN 'passport_authenticity_failed'             THEN 'document_authenticity_failed'
	WHEN 'passport_active_authentication_failed'    THEN 'document_active_authentication_failed'
	WHEN 'passport_chip_authentication_failed'      THEN 'document_chip_authentication_failed'
	WHEN 'passport_anti_cloning_attestation_failed' THEN 'document_anti_cloning_attestation_failed'
	ELSE "failure_code"
END
WHERE "failure_code" LIKE 'passport_%';

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
			'selfie_face_mismatch'
		)
	);
