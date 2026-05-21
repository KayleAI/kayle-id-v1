import { logEvent, logSafeError } from "@kayle-id/config/logging";
import type { ApiRequestLogger } from "@/logging";
import {
	resolveBiometricVerifierSecret,
	resolveBiometricVerifierServiceBinding,
} from "./biometric-verifier-env";
import {
	createBiometricVerifierRequest,
	fetchBiometricVerifier,
} from "./biometric-verifier-http";
import { BIOMETRIC_VERIFIER_PREWARM_PATH } from "./biometric-verifier-types";

export async function prewarmBiometricVerifier({
	env,
	sessionId,
	logger,
}: {
	env: unknown;
	sessionId?: string;
	logger?: ApiRequestLogger;
}): Promise<void> {
	const verifierBinding = resolveBiometricVerifierServiceBinding(env);
	const verifierSecret = resolveBiometricVerifierSecret(env);

	if (!verifierBinding || !verifierSecret) {
		return;
	}

	const startedAt = Date.now();
	try {
		const request = createBiometricVerifierRequest({
			path: BIOMETRIC_VERIFIER_PREWARM_PATH,
			method: "POST",
			verifierSecret,
		});
		const response = await fetchBiometricVerifier(verifierBinding, request);

		logEvent(logger, {
			details: {
				session_id: sessionId ?? null,
				duration_ms: Date.now() - startedAt,
				status: response.status,
			},
			event: "verify.biometric_verifier.prewarm_triggered",
		});
	} catch (error) {
		logSafeError(logger, {
			code: "biometric_verifier_prewarm_failed",
			details: {
				session_id: sessionId ?? null,
				duration_ms: Date.now() - startedAt,
			},
			error,
			event: "verify.biometric_verifier.prewarm_failed",
			message: "Biometric verifier prewarm request failed.",
		});
	}
}
