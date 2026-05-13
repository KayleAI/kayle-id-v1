import { bufferBytes } from "./sod-asn1-utils";

const LIVENESS_CHALLENGE_LABEL = "liveness:";
const CHALLENGE_NONCE_BYTES = 4;
// 8s headroom for capture + UX prompts. Container-side timing checks use the
// recorded video duration, so this is a soft client deadline, not a hard cap.
const DEFAULT_MAX_DURATION_MS = 8_000;

export type LivenessChallenge = {
	maxDurationMs: number;
	challengeNonce: Uint8Array;
};

/**
 * Derive a per-attempt liveness challenge nonce from the server-only secret.
 * Deterministic so a reconnect during liveness capture re-issues the same
 * value, but unpredictable without the secret — clients echo it back via
 * the recorded video timing so the server can detect replay where an
 * attacker reuses a previously-captured clip across attempts.
 *
 * The first 4 bytes of HMAC-SHA256("liveness:" + attemptId) are returned
 * as the wire-visible challengeNonce. A previous version of this flow
 * also issued a server-decided pose sequence in the same challenge; that
 * sequence was dropped because the v2 liveness flow derives pose from
 * video frames server-side without needing a pre-issued order.
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
