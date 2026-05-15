import { bufferBytes } from "./sod-asn1-utils";

const LIVENESS_CHALLENGE_LABEL = "liveness:";
const CHALLENGE_NONCE_BYTES = 4;
// Soft client deadline; container-side timing checks use the recorded
// video duration.
const DEFAULT_MAX_DURATION_MS = 8_000;

export type LivenessChallenge = {
	maxDurationMs: number;
	challengeNonce: Uint8Array;
};

/**
 * HMAC-derived liveness challenge nonce. Deterministic per attemptId so
 * reconnects re-issue the same value; unpredictable without
 * `authSecret`. Intended to be echoed inside the recorded video so the
 * verifier can bind the clip to this attempt.
 *
 * Currently: server derives + sends and the nonce flows through to the
 * verifier, but the iOS embed + verifier extract halves are not yet
 * wired — see TODO(liveness-nonce-extraction) in LivenessCaptureView
 * and service.py. Until both land the nonce is telemetry only.
 *
 * 4 bytes is too short for replay resistance on its own; once the
 * bytes-in-video check lands, pair it with the duration/frame-count
 * timing window so 4 bytes × timing resists brute force.
 */
export async function deriveLivenessChallenge({
	attemptId,
	authSecret,
	maxDurationMs = DEFAULT_MAX_DURATION_MS,
}: {
	attemptId: string;
	authSecret: string;
	maxDurationMs?: number;
}): Promise<LivenessChallenge> {
	const secretBytes = new TextEncoder().encode(authSecret);
	const payloadBytes = new TextEncoder().encode(
		`${LIVENESS_CHALLENGE_LABEL}${attemptId}`,
	);
	const key = await crypto.subtle.importKey(
		"raw",
		bufferBytes(secretBytes),
		{
			hash: "SHA-256",
			name: "HMAC",
		},
		false,
		["sign"],
	);
	const signature = new Uint8Array(
		await crypto.subtle.sign("HMAC", key, bufferBytes(payloadBytes)),
	);

	const challengeNonce = signature.slice(0, CHALLENGE_NONCE_BYTES);

	return {
		maxDurationMs,
		challengeNonce,
	};
}
