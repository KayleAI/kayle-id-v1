import {
	BIOMETRIC_VERIFIER_AUTH_HEADER,
	biometricVerifierResponseSchema,
	createBiometricVerifierRequestFormData,
} from "@kayle-id/config/biometric-verifier";
import { logEvent, logSafeError } from "@kayle-id/config/logging";
import type { ApiRequestLogger } from "@/logging";

type BiometricVerifierServiceBinding = {
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

function createUnavailableResult(reason: string): LivenessVerificationResult {
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

function resolveStringEnvValue(env: unknown, key: string): string | null {
	if (!env || typeof env !== "object") {
		return null;
	}

	const candidate = Reflect.get(env, key);
	return typeof candidate === "string" && candidate.length > 0
		? candidate
		: null;
}

function resolveBiometricVerifierServiceBinding(
	env: unknown,
): BiometricVerifierServiceBinding | null {
	if (!(env && typeof env === "object")) {
		return null;
	}

	const candidate = Reflect.get(env, "BIOMETRIC_VERIFIER");

	if (!(candidate && typeof candidate === "object")) {
		return null;
	}

	const fetchBinding = Reflect.get(candidate, "fetch");

	return typeof fetchBinding === "function"
		? (candidate as BiometricVerifierServiceBinding)
		: null;
}

function resolveBiometricVerifierSecret(env: unknown): string | null {
	return resolveStringEnvValue(env, "BIOMETRIC_VERIFIER_SECRET");
}

async function requestBiometricVerifier({
	dg2Image,
	video,
	challengeNonce,
	faceMatchThreshold,
	verifierBinding,
	verifierSecret,
	attemptId,
	logger,
}: {
	dg2Image: Uint8Array;
	video: Uint8Array;
	challengeNonce?: Uint8Array;
	faceMatchThreshold?: number;
	verifierBinding: BiometricVerifierServiceBinding;
	verifierSecret: string;
	attemptId?: string;
	logger?: ApiRequestLogger;
}): Promise<LivenessVerificationResult> {
	const startedAt = Date.now();
	const formData = createBiometricVerifierRequestFormData({
		dg2Image,
		video,
		challengeNonce,
		faceMatchThreshold,
	});

	try {
		const request = new Request(
			"https://biometric-verifier.internal/verify_liveness",
			{
				body: formData,
				headers: {
					authorization: `Bearer ${verifierSecret}`,
					[BIOMETRIC_VERIFIER_AUTH_HEADER]: verifierSecret,
				},
				method: "POST",
			},
		);
		const response = (await Reflect.apply(
			verifierBinding.fetch,
			verifierBinding,
			[request],
		)) as Response;

		if (!response.ok) {
			logEvent(logger, {
				details: {
					attempt_id: attemptId ?? null,
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
					attempt_id: attemptId ?? null,
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
					attempt_id: attemptId ?? null,
					duration_ms: Date.now() - startedAt,
					error_code: "biometric_verifier_invalid_response",
					issue_count: payload.error.issues.length,
				},
				event: "verify.biometric_verifier.invalid_response",
				level: "warn",
			});
			return createUnavailableResult("biometric_verifier_unavailable");
		}

		logEvent(logger, {
			details: {
				attempt_id: attemptId ?? null,
				duration_ms: Date.now() - startedAt,
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

		return {
			livenessPassed: payload.data.livenessPassed,
			livenessScore: payload.data.livenessScore,
			faceMatchPassed: payload.data.faceMatchPassed,
			faceMatchScore: payload.data.faceMatchScore,
			padPassed: payload.data.padPassed,
			padScore: payload.data.padScore,
			usedFallback: payload.data.usedFallback,
			// Normalize the wire-level `null` reason (sent on the happy path)
			// to undefined so callers can use the simple `result.reason ? …`
			// idiom without worrying about null vs undefined.
			reason: payload.data.reason ?? undefined,
		};
	} catch (error) {
		logSafeError(logger, {
			code: "biometric_verifier_request_failed",
			details: {
				attempt_id: attemptId ?? null,
				duration_ms: Date.now() - startedAt,
			},
			error,
			event: "verify.biometric_verifier.request_failed",
			message: "Biometric verifier request failed.",
		});
		return createUnavailableResult("biometric_verifier_unavailable");
	}
}

export function verifyLiveness({
	dg2Image,
	video,
	challengeNonce,
	faceMatchThreshold,
	env,
	attemptId,
	logger,
}: {
	dg2Image: Uint8Array;
	video: Uint8Array;
	challengeNonce?: Uint8Array;
	faceMatchThreshold?: number;
	env: unknown;
	attemptId?: string;
	logger?: ApiRequestLogger;
}): Promise<LivenessVerificationResult> {
	const verifierBinding = resolveBiometricVerifierServiceBinding(env);
	const verifierSecret = resolveBiometricVerifierSecret(env);

	if (!verifierBinding) {
		logEvent(logger, {
			details: {
				attempt_id: attemptId ?? null,
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
		// Fail-closed when the API side is missing the shared secret. The
		// verifier worker also rejects unsigned requests, so sending one would
		// produce a 503 anyway — but bailing here keeps the missing-secret
		// signal local and makes the logs unambiguous.
		logEvent(logger, {
			details: {
				attempt_id: attemptId ?? null,
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
		dg2Image,
		video,
		challengeNonce,
		faceMatchThreshold,
		attemptId,
		logger,
	});
}
