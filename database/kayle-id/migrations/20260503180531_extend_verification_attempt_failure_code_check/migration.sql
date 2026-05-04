-- The 0003 CHECK constraint was authored before Active Authentication and
-- Chip Authentication landed, so writes from those rejection paths
-- (`passport_active_authentication_failed`, `passport_chip_authentication_failed`)
-- were rejected by the database even though the Drizzle enum allowed them. Drop
-- and re-add the constraint with the full set of failure codes the application
-- can produce today.
ALTER TABLE "verification_attempts"
DROP CONSTRAINT IF EXISTS "verif_attempts_failure_code_check";

ALTER TABLE "verification_attempts"
ADD CONSTRAINT "verif_attempts_failure_code_check"
CHECK (
	"failure_code" IS NULL
	OR "failure_code" IN (
		'session_expired',
		'session_cancelled',
		'passport_authenticity_failed',
		'passport_active_authentication_failed',
		'passport_chip_authentication_failed',
		'selfie_face_mismatch'
	)
);
