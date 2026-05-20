import {
	COST_FEATURES,
	emitCostEvent,
	resolveAnalyticsDataset,
} from "@kayle-id/config/analytics-cost-events";
import {
	BIOMETRIC_VERIFIER_AUTH_HEADER,
	biometricVerifierResponseSchema,
	createBiometricVerifierRequestFormData,
} from "@kayle-id/config/biometric-verifier";
import { logEvent, logSafeError } from "@kayle-id/config/logging";
import { config } from "@/config";
import type { ApiRequestLogger } from "@/logging";

const WORKER_NAME = "kayle-id-api";
const BIOMETRIC_VERIFIER_READY_ATTEMPTS = 80;
const BIOMETRIC_VERIFIER_READY_RETRY_DELAY_MS = 250;

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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object";
}

function parseVerifierReady(payload: unknown): boolean {
	if (!isObjectRecord(payload)) {
		return false;
	}

	const data = payload.data;
	return isObjectRecord(data) && data.ready === true;
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBiometricVerifierReady({
	verifierBinding,
	verifierSecret,
	sessionId,
	logger,
}: {
	verifierBinding: BiometricVerifierServiceBinding;
	verifierSecret: string;
	sessionId?: string;
	logger?: ApiRequestLogger;
}): Promise<boolean> {
	const startedAt = Date.now();
	let lastStatus: number | null = null;

	for (
		let attempt = 1;
		attempt <= BIOMETRIC_VERIFIER_READY_ATTEMPTS;
		attempt += 1
	) {
		try {
			const request = new Request(
				"https://biometric-verifier.internal/health",
				{
					headers: {
						authorization: `Bearer ${verifierSecret}`,
						[BIOMETRIC_VERIFIER_AUTH_HEADER]: verifierSecret,
					},
					method: "GET",
				},
			);
			const response = (await Reflect.apply(
				verifierBinding.fetch,
				verifierBinding,
				[request],
			)) as Response;
			lastStatus = response.status;

			if (response.ok) {
				const payload = await response.json().catch(() => null);
				if (parseVerifierReady(payload)) {
					if (attempt > 1) {
						logEvent(logger, {
							details: {
								session_id: sessionId ?? null,
								duration_ms: Date.now() - startedAt,
								ready_attempts: attempt,
							},
							event: "verify.biometric_verifier.ready_waited",
						});
					}
					return true;
				}
			}
		} catch {
			lastStatus = null;
		}

		if (attempt < BIOMETRIC_VERIFIER_READY_ATTEMPTS) {
			await wait(BIOMETRIC_VERIFIER_READY_RETRY_DELAY_MS);
		}
	}

	logEvent(logger, {
		details: {
			session_id: sessionId ?? null,
			duration_ms: Date.now() - startedAt,
			error_code: "biometric_verifier_not_ready",
			last_status: lastStatus,
			ready_attempts: BIOMETRIC_VERIFIER_READY_ATTEMPTS,
		},
		event: "verify.biometric_verifier.not_ready",
		level: "warn",
	});
	return false;
}

async function requestBiometricVerifier({
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

		const request = new Request("https://biometric-verifier.internal/verify", {
			body: formData,
			headers: {
				authorization: `Bearer ${verifierSecret}`,
				[BIOMETRIC_VERIFIER_AUTH_HEADER]: verifierSecret,
			},
			method: "POST",
		});
		const response = (await Reflect.apply(
			verifierBinding.fetch,
			verifierBinding,
			[request],
		)) as Response;

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
				session_id: sessionId ?? null,
				duration_ms: Date.now() - startedAt,
			},
			error,
			event: "verify.biometric_verifier.request_failed",
			message: "Biometric verifier request failed.",
		});
		return createUnavailableResult("biometric_verifier_unavailable");
	} finally {
		// Emit container_active on every path the container saw work for —
		// success, HTTP error, malformed/invalid response body, or thrown
		// exception. Wall-clock overestimates the container's active time
		// by the service-binding hop (single-digit ms); _perfTrace.totalMs
		// would be exact but only emits in bench mode. The dashboard
		// breaks down by feature, so failed verifies still count toward
		// the verify-flow cost line rather than vanishing into uncosted
		// time.
		emitCostEvent({
			dataset: resolveAnalyticsDataset(env),
			organizationId,
			feature: COST_FEATURES.Verify,
			resource: "container_active",
			quantity: Date.now() - startedAt,
			unit: "ms",
			workerName: WORKER_NAME,
			environment: config.environment ?? "unknown",
			version: config.version,
		});
	}
}

/**
 * Fire-and-forget wake of the biometric verifier container. Used when
 * the session phase transitions to `liveness_capturing` — the user is
 * about to record video, so we have ~10-15s of capture/upload time for
 * the container to cold-boot and load models in parallel. Resolves
 * once the verifier acknowledges (typically <100ms); the actual model
 * load continues asynchronously inside the container.
 *
 * Safe to call repeatedly: idempotent on the verifier side.
 * Misconfiguration (missing binding/secret) is logged and swallowed —
 * the user's later /verify will surface any real issue.
 */
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
		const request = new Request("https://biometric-verifier.internal/prewarm", {
			method: "POST",
			headers: {
				authorization: `Bearer ${verifierSecret}`,
				[BIOMETRIC_VERIFIER_AUTH_HEADER]: verifierSecret,
			},
		});
		const response = (await Reflect.apply(
			verifierBinding.fetch,
			verifierBinding,
			[request],
		)) as Response;

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
		// Fail-closed when the API side is missing the shared secret. The
		// verifier worker also rejects unsigned requests, so sending one would
		// produce a 503 anyway — but bailing here keeps the missing-secret
		// signal local and makes the logs unambiguous.
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
