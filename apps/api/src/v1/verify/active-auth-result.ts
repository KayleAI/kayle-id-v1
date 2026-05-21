import type {
	ActiveAuthFailureReason,
	ActiveAuthValidationResult,
} from "./validation-types";

export const ICAO_CHALLENGE_BYTES = 8;

export function failureResult(
	reason: ActiveAuthFailureReason,
	detail: string | null = null,
): ActiveAuthValidationResult {
	return {
		detail,
		ok: false,
		reason,
	};
}

export function concatenateBytes(
	left: Uint8Array,
	right: Uint8Array,
): Uint8Array {
	const combined = new Uint8Array(left.length + right.length);
	combined.set(left, 0);
	combined.set(right, left.length);
	return combined;
}
