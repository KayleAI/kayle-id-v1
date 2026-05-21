import { logEvent } from "@kayle-id/config/logging";
import type { ApiRequestLogger } from "@/logging";
import {
	resolveBiometricVerifierSecret,
	resolveBiometricVerifierServiceBinding,
} from "./biometric-verifier-env";

export { prewarmBiometricVerifier } from "./biometric-verifier-prewarm";

import { requestBiometricVerifier } from "./biometric-verifier-request";
import {
	createUnavailableResult,
	type LivenessVerificationResult,
} from "./biometric-verifier-types";

export type { LivenessVerificationResult } from "./biometric-verifier-types";

export function verifyLiveness({
	dg2Image,
	video,
	challengeNonce,
	faceMatchThreshold,
	env,
	organizationId,
	sessionId,
	logger,
}: {
	dg2Image: Uint8Array;
	video: Uint8Array;
	challengeNonce?: Uint8Array;
	faceMatchThreshold?: number;
	env: unknown;
	organizationId?: string;
	sessionId?: string;
	logger?: ApiRequestLogger;
}): Promise<LivenessVerificationResult> {
	const verifierBinding = resolveBiometricVerifierServiceBinding(env);
	const verifierSecret = resolveBiometricVerifierSecret(env);

	if (!verifierBinding) {
		logEvent(logger, {
			details: {
				session_id: sessionId ?? null,
				error_code: "biometric_verifier_config_missing",
				dg2_bytes: dg2Image.length,
				video_bytes: video.length,
			},
			event: "verify.biometric_verifier.config_missing",
			level: "warn",
		});

		return Promise.resolve(
			createUnavailableResult("biometric_verifier_unavailable"),
		);
	}

	if (!verifierSecret) {
		logEvent(logger, {
			details: {
				session_id: sessionId ?? null,
				error_code: "biometric_verifier_secret_missing",
			},
			event: "verify.biometric_verifier.misconfigured",
			level: "warn",
		});

		return Promise.resolve(
			createUnavailableResult("biometric_verifier_misconfigured"),
		);
	}

	return requestBiometricVerifier({
		verifierBinding,
		verifierSecret,
		env,
		dg2Image,
		video,
		challengeNonce,
		faceMatchThreshold,
		organizationId,
		sessionId,
		logger,
	});
}
