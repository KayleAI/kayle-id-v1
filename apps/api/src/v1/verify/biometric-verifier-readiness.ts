import { logEvent } from "@kayle-id/config/logging";
import type { ApiRequestLogger } from "@/logging";
import {
	createBiometricVerifierRequest,
	fetchBiometricVerifier,
} from "./biometric-verifier-http";
import {
	BIOMETRIC_VERIFIER_HEALTH_PATH,
	type BiometricVerifierServiceBinding,
} from "./biometric-verifier-types";

const BIOMETRIC_VERIFIER_READY_ATTEMPTS = 80;
const BIOMETRIC_VERIFIER_READY_RETRY_DELAY_MS = 250;

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

export async function waitForBiometricVerifierReady({
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
			const request = createBiometricVerifierRequest({
				path: BIOMETRIC_VERIFIER_HEALTH_PATH,
				method: "GET",
				verifierSecret,
			});
			const response = await fetchBiometricVerifier(verifierBinding, request);
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
