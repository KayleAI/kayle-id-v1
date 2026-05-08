import { APPLE_APP_ATTEST_ROOT_CA_PEM } from "./app-attest-root-ca";

/**
 * Trust-anchor accessors for Apple App Attest. The cert itself lives in
 * `app-attest-root-ca.ts` for reviewers to audit.
 */
const APPLE_APP_ATTEST_ROOT_CA_SHA256_FINGERPRINT =
	"1cb9823ba28ba6ad2d33a006941de2ae4f513ef1d4e831b9f7e0fa7b6242c932" as const;

export function getAppAttestRootCertPem(): string {
	if (!APPLE_APP_ATTEST_ROOT_CA_PEM) {
		throw new Error(
			"app_attest_root_ca_not_configured: paste Apple's published App Attest Root CA PEM into apps/api/src/v1/verify/app-attest-root-ca.ts before deploying.",
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
