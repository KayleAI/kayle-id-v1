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
 * `authSecret`. Clients echo it back inside the recorded video.
 *
 * Replay defence is timing-based: the verifier container compares
 * the recorded video duration / frame count against the nonce-bound
 * challenge and rejects clips whose timing doesn't match this
 * specific attempt. The 4-byte nonce alone is too short for
 * meaningful replay resistance — if the container's timing
 * validation is ever disabled or relaxed, this becomes unsafe and
 * the nonce must be widened (or paired with a per-attempt token).
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
