import type {
	AuthenticityValidationResult,
	PassiveAuthCrlStatus,
	PassiveAuthFailureReason,
	PassiveAuthRevocationOutcome,
	PassiveAuthSignerSource,
} from "./validation-types";

export function normalizeSodFailureReason(
	error: unknown,
): PassiveAuthFailureReason {
	const reason = error instanceof Error ? error.message : "";

	if (reason === "required_dg_hash_missing") {
		return "required_dg_hash_missing";
	}

	if (reason === "unsupported_digest_algorithm") {
		return "unsupported_digest_algorithm";
	}

	return "parse_failure";
}

export function passiveAuthFailureResult({
	crlStatus = "not_checked",
	detail = null,
	reason,
	revocationOutcome = null,
	signerSource = null,
}: {
	crlStatus?: PassiveAuthCrlStatus;
	detail?: string | null;
	reason: PassiveAuthFailureReason;
	revocationOutcome?: PassiveAuthRevocationOutcome | null;
	signerSource?: PassiveAuthSignerSource | null;
}): AuthenticityValidationResult {
	return {
		crlStatus,
		detail,
		ok: false,
		reason,
		revocationOutcome,
		signerSource,
	};
}
