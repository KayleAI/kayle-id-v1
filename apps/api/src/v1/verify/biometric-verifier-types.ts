export const BIOMETRIC_VERIFIER_HEALTH_PATH = "/health";
export const BIOMETRIC_VERIFIER_PREWARM_PATH = "/prewarm";
export const BIOMETRIC_VERIFIER_VERIFY_PATH = "/verify";
export const BIOMETRIC_VERIFIER_INTERNAL_ORIGIN =
	"https://biometric-verifier.internal";
export const BIOMETRIC_VERIFIER_WORKER_NAME = "kayle-id-api";

export type BiometricVerifierServiceBinding = {
	fetch: typeof fetch;
};

export type LivenessVerificationResult = {
	livenessPassed: boolean;
	livenessScore: number | null;
	faceMatchPassed: boolean;
	faceMatchScore: number | null;
	padPassed: boolean;
	padScore: number | null;
	usedFallback: boolean;
	reason?: string;
};

export function createUnavailableResult(
	reason: string,
): LivenessVerificationResult {
	return {
		livenessPassed: false,
		livenessScore: null,
		faceMatchPassed: false,
		faceMatchScore: null,
		padPassed: false,
		padScore: null,
		usedFallback: true,
		reason,
	};
}
