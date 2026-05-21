import {
	COST_FEATURES,
	emitCostEvent,
	resolveAnalyticsDataset,
} from "@kayle-id/config/analytics-cost-events";
import {
	biometricVerifierResponseSchema,
	createBiometricVerifierRequestFormData,
} from "@kayle-id/config/biometric-verifier";
import { logEvent, logSafeError } from "@kayle-id/config/logging";
import { config } from "@/config";
import type { ApiRequestLogger } from "@/logging";
import {
	createBiometricVerifierRequest,
	fetchBiometricVerifier,
} from "./biometric-verifier-http";
import { waitForBiometricVerifierReady } from "./biometric-verifier-readiness";
import {
	BIOMETRIC_VERIFIER_VERIFY_PATH,
	BIOMETRIC_VERIFIER_WORKER_NAME,
	type BiometricVerifierServiceBinding,
	createUnavailableResult,
	type LivenessVerificationResult,
} from "./biometric-verifier-types";

function resultFromVerifierPayload(
	payload: typeof biometricVerifierResponseSchema._output,
): LivenessVerificationResult {
	return {
		livenessPassed: payload.livenessPassed,
		livenessScore: payload.livenessScore,
		faceMatchPassed: payload.faceMatchPassed,
		faceMatchScore: payload.faceMatchScore,
		padPassed: payload.padPassed,
		padScore: payload.padScore,
		usedFallback: payload.usedFallback,
		reason: payload.reason ?? undefined,
	};
}

export async function requestBiometricVerifier({
	dg2Image,
	video,
	challengeNonce,
	faceMatchThreshold,
	verifierBinding,
	verifierSecret,
	env,
	organizationId,
	sessionId,
	logger,
}: {
	dg2Image: Uint8Array;
	video: Uint8Array;
	challengeNonce?: Uint8Array;
	faceMatchThreshold?: number;
	verifierBinding: BiometricVerifierServiceBinding;
	verifierSecret: string;
	env: unknown;
	organizationId?: string;
	sessionId?: string;
	logger?: ApiRequestLogger;
}): Promise<LivenessVerificationResult> {
	const startedAt = Date.now();

	try {
		const ready = await waitForBiometricVerifierReady({
			verifierBinding,
			verifierSecret,
			sessionId,
			logger,
		});

		if (!ready) {
			return createUnavailableResult(
				"biometric_verifier_unavailable:not_ready",
			);
		}

		const formData = createBiometricVerifierRequestFormData({
			dg2Image,
			video,
			challengeNonce,
			faceMatchThreshold,
		});
		const request = createBiometricVerifierRequest({
			path: BIOMETRIC_VERIFIER_VERIFY_PATH,
			method: "POST",
			verifierSecret,
			body: formData,
		});
		const response = await fetchBiometricVerifier(verifierBinding, request);

		if (!response.ok) {
			logEvent(logger, {
				details: {
					session_id: sessionId ?? null,
					error_code: "biometric_verifier_http_error",
					status: response.status,
					duration_ms: Date.now() - startedAt,
				},
				event: "verify.biometric_verifier.http_error",
				level: "warn",
			});
			return createUnavailableResult("biometric_verifier_unavailable");
		}

		const json = await response.json().catch((error) => {
			logSafeError(logger, {
				code: "biometric_verifier_invalid_json",
				details: {
					session_id: sessionId ?? null,
					duration_ms: Date.now() - startedAt,
				},
				error,
				event: "verify.biometric_verifier.invalid_json",
				message: "Biometric verifier returned invalid JSON.",
			});
			return null;
		});

		if (json === null) {
			return createUnavailableResult("biometric_verifier_unavailable");
		}

		const payload = biometricVerifierResponseSchema.safeParse(json);

		if (!payload.success) {
			logEvent(logger, {
				details: {
					session_id: sessionId ?? null,
					duration_ms: Date.now() - startedAt,
					error_code: "biometric_verifier_invalid_response",
					issue_count: payload.error.issues.length,
				},
				event: "verify.biometric_verifier.invalid_response",
				level: "warn",
			});
			return createUnavailableResult("biometric_verifier_unavailable");
		}

		const durationMs = Date.now() - startedAt;
		logEvent(logger, {
			details: {
				session_id: sessionId ?? null,
				duration_ms: durationMs,
				face_match_passed: payload.data.faceMatchPassed,
				face_match_score: payload.data.faceMatchScore,
				liveness_passed: payload.data.livenessPassed,
				liveness_score: payload.data.livenessScore,
				pad_passed: payload.data.padPassed,
				pad_score: payload.data.padScore,
				used_fallback: payload.data.usedFallback,
				reason: payload.data.reason ?? null,
			},
			event: "verify.biometric_verifier.request_succeeded",
		});

		return resultFromVerifierPayload(payload.data);
	} catch (error) {
		logSafeError(logger, {
			code: "biometric_verifier_request_failed",
			details: {
				session_id: sessionId ?? null,
				duration_ms: Date.now() - startedAt,
			},
			error,
			event: "verify.biometric_verifier.request_failed",
			message: "Biometric verifier request failed.",
		});
		return createUnavailableResult("biometric_verifier_unavailable");
	} finally {
		emitCostEvent({
			dataset: resolveAnalyticsDataset(env),
			organizationId,
			feature: COST_FEATURES.Verify,
			resource: "container_active",
			quantity: Date.now() - startedAt,
			unit: "ms",
			workerName: BIOMETRIC_VERIFIER_WORKER_NAME,
			environment: config.environment ?? "unknown",
			version: config.version,
		});
	}
}
