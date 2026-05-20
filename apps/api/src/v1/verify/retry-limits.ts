export const MAX_NFC_RETRIES = 3;
export const MAX_LIVENESS_RETRIES = 3;

export type CheckKind = "mrz" | "nfc" | "liveness";
export type NegativeFailureCode =
	| "document_anti_cloning_attestation_failed"
	| "document_authenticity_failed"
	| "document_active_authentication_failed"
	| "document_chip_authentication_failed"
	| "document_data_invalid"
	| "liveness_failed"
	| "selfie_face_mismatch";

export function failedCheckForCode(code: NegativeFailureCode): CheckKind {
	if (code === "document_data_invalid") {
		return "mrz";
	}
	if (code === "liveness_failed" || code === "selfie_face_mismatch") {
		return "liveness";
	}
	return "nfc";
}

/**
 * Hard-kill reason codes terminate the session immediately, bypassing per-check
 * retry budgets. Attestation failures fall here because they implicate the
 * device/app trust anchor, not a recoverable user action.
 */
export function isHardKillCode(code: NegativeFailureCode): boolean {
	return code === "document_anti_cloning_attestation_failed";
}
