import { bufferBytes } from "./sod-asn1-utils";

const LIVENESS_CHALLENGE_LABEL = "liveness:";
const CHALLENGE_NONCE_BYTES = 4;
const PERMUTATION_BYTES = 2;
// 8s headroom for capture + UX prompts. Container-side timing checks use the
// recorded video duration, so this is a soft client deadline, not a hard cap.
const DEFAULT_MAX_DURATION_MS = 8_000;

export type LivenessPoseValue = "center" | "left" | "right";

export type LivenessChallenge = {
	poseSequence: LivenessPoseValue[];
	maxDurationMs: number;
	challengeNonce: Uint8Array;
};

const BASE_SEQUENCE: readonly LivenessPoseValue[] = ["center", "left", "right"];

/**
 * Derive a randomized head-movement challenge from a server-only secret.
 * Deterministic so a reconnect during liveness capture re-issues the same
 * sequence, but unpredictable without the secret — which is what defeats
 * replay attacks where an attacker records the correct head movement once
 * and replays it across attempts.
 *
 * The first 4 bytes of HMAC-SHA256("liveness:" + attemptId) are returned
 * as the wire-visible challengeNonce; the next 2 bytes seed a Fisher-Yates
 * permutation of [center, left, right]. Three poses → six permutations →
 * 6 + 2 = 8 bits of entropy in the pose order alone, on top of the four
 * bytes of nonce.
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
	const permutationSeed = signature.slice(
		CHALLENGE_NONCE_BYTES,
		CHALLENGE_NONCE_BYTES + PERMUTATION_BYTES,
	);

	return {
		poseSequence: permutePoseSequence(BASE_SEQUENCE, permutationSeed),
		maxDurationMs,
		challengeNonce,
	};
}

/**
 * Fisher-Yates shuffle over the base [center, left, right] array. With three
 * elements we draw two swap indices from seedBytes: index 0 picks j ∈ [0, 2]
 * for the i=2 step (3 options), index 1 picks j ∈ [0, 1] for the i=1 step
 * (2 options). Uniform over all six permutations when seedBytes is uniform.
 */
function permutePoseSequence(
	source: readonly LivenessPoseValue[],
	seedBytes: Uint8Array,
): LivenessPoseValue[] {
	const result: LivenessPoseValue[] = [...source];
	const firstSeed = seedBytes[0] ?? 0;
	const secondSeed = seedBytes[1] ?? 0;
	const j2 = firstSeed % 3;
	const j1 = secondSeed % 2;

	swap(result, 2, j2);
	swap(result, 1, j1);

	return result;
}

function swap<T>(values: T[], leftIndex: number, rightIndex: number): void {
	if (leftIndex === rightIndex) {
		return;
	}

	const tmp = values[leftIndex] as T;
	values[leftIndex] = values[rightIndex] as T;
	values[rightIndex] = tmp;
}
