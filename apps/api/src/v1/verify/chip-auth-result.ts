import type {
	ChipAuthFailureReason,
	ChipAuthValidationResult,
} from "./validation-types";

export function failureResult(
	reason: ChipAuthFailureReason,
	detail: string | null = null,
): ChipAuthValidationResult {
	return {
		detail,
		ok: false,
		reason,
	};
}
