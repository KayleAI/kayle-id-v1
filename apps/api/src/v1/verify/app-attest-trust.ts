/**
 * Pinned trust anchor for Apple App Attest. Apple publishes a single root CA
 * that signs the per-device leaf certificates carried inside an attestation
 * statement's `x5c` chain. We pin the root in code (not a CRL-driven trust
 * store) because:
 *
 *   - the root is constant, public, and long-lived;
 *   - any legitimate iOS App Attest attestation chains to it;
 *   - rotating away from this root would require an Apple platform-wide event,
 *     which would also require a coordinated app + server update.
 *
 * The PEM below MUST be the byte-for-byte content of:
 *
 *   https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem
 *
 * Apple documents this URL on their PKI page; verify the download by the
 * SHA-256 fingerprint Apple publishes alongside it before pasting. A wrong
 * root rejects every legitimate attestation, so deploys must validate this
 * value against Apple's published fingerprint as part of release.
 *
 * Until the real PEM is pasted, `getAppAttestRootCertPem` throws and the
 * attestation register endpoint fail-closes — preventing accidental ship of
 * a placeholder root.
 */
const APPLE_APP_ATTEST_ROOT_CA_PEM = "" as const;

const APPLE_APP_ATTEST_ROOT_CA_SHA256_FINGERPRINT = "" as const;

export function getAppAttestRootCertPem(): string {
	if (!APPLE_APP_ATTEST_ROOT_CA_PEM) {
		throw new Error(
			"app_attest_root_ca_not_configured: paste Apple's published App Attest Root CA PEM into apps/api/src/v1/verify/app-attest-trust.ts before deploying.",
		);
	}
	return APPLE_APP_ATTEST_ROOT_CA_PEM;
}

export function getAppAttestRootCertFingerprint(): string {
	if (!APPLE_APP_ATTEST_ROOT_CA_SHA256_FINGERPRINT) {
		throw new Error(
			"app_attest_root_ca_fingerprint_not_configured: paste the published SHA-256 fingerprint into apps/api/src/v1/verify/app-attest-trust.ts before deploying.",
		);
	}
	return APPLE_APP_ATTEST_ROOT_CA_SHA256_FINGERPRINT;
}

export const APPLE_APP_ATTEST_ROOT_CA_SUBJECT_CN =
	"Apple App Attestation Root CA";
