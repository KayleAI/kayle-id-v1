export type SupportedHashAlgorithm =
	| "SHA-256"
	| "SHA-384"
	| "SHA-512"
	| "SHA-1";

export type SupportedImageFormat = "jpeg" | "jpeg2000";

export type PassiveAuthCrlStatus =
	| "not_checked"
	| "revoked"
	| "missing"
	| "stale"
	| "verified_not_revoked";

/**
 * Revocation outcome derived from the observed CRL status. Surfaced separately
 * from authenticity so that valid passports under incomplete or stale CRL
 * coverage are not treated as cryptographic failures.
 */
export type PassiveAuthRevocationOutcome =
	| "verified_not_revoked"
	| "revocation_unknown"
	| "revoked";

export type PassiveAuthFailureReason =
	| "chain_untrusted"
	| "crl_revoked"
	| "cms_signature_invalid"
	| "dg_hash_mismatch"
	| "missing_required_artifacts"
	| "missing_signer"
	| "missing_signer_certificate"
	| "parse_failure"
	| "required_dg_hash_missing"
	| "signer_certificate_expired"
	| "signer_certificate_invalid"
	| "signer_certificate_not_yet_valid"
	| "sod_declared_dg_missing"
	| "sod_undeclared_dg_supplied"
	| "trust_bundle_unavailable"
	| "unsupported_digest_algorithm";

export type ActiveAuthFailureReason =
	| "challenge_invalid_length"
	| "challenge_mismatch"
	| "dg14_parse_failed"
	| "dg15_missing"
	| "dg15_parse_failed"
	| "public_key_invalid"
	| "signature_format_invalid"
	| "signature_invalid"
	| "signature_invalid_encoding"
	| "signature_missing"
	| "sod_dg15_hash_mismatch"
	| "sod_dg15_hash_missing";

export type ActiveAuthValidationResult =
	| {
			ok: true;
			algorithm: "rsa" | "ecdsa";
			hashAlgorithm: "SHA-1" | "SHA-224" | "SHA-256" | "SHA-384" | "SHA-512";
	  }
	| {
			ok: false;
			reason: ActiveAuthFailureReason;
			detail?: string | null;
	  };

export type ChipAuthFailureReason =
	| "algorithm_unsupported"
	| "chip_curve_unsupported"
	| "chip_public_key_invalid"
	| "chip_public_key_not_found"
	| "chip_token_mismatch"
	| "dg14_missing"
	| "dg14_parse_failed"
	| "dh_unsupported"
	| "info_not_found"
	| "key_agreement_failed"
	| "mac_algorithm_unsupported"
	| "sod_dg14_hash_mismatch"
	| "terminal_public_key_invalid"
	| "transcript_missing"
	| "transcript_parse_failed";

export type ChipAuthValidationResult =
	| {
			ok: true;
			algorithm: string;
			keyAgreement: "DH" | "ECDH";
	  }
	| {
			ok: false;
			reason: ChipAuthFailureReason;
			detail?: string | null;
	  };

export type PassiveAuthSignerSource = "bundle" | "sod";

export type Dg2FaceImage = {
	imageData: Uint8Array;
	imageFormat: SupportedImageFormat;
	imageWidth: number;
	imageHeight: number;
};

// 0.7 normalised ≈ raw cosine 0.4 — InsightFace's canonical "same
// person" threshold for glint360k-trained ArcFace R100. Same-identity
// pairs typically score 0.65-0.85, cross-identity well below 0.6.
export const DEFAULT_FACE_MATCH_THRESHOLD = 0.7;

export type SodDeclares = {
	dg14: boolean;
	dg15: boolean;
};

export type Dg14Declares = {
	chipAuthentication: boolean;
};

export type AuthenticityValidationResult =
	| {
			crlStatus: Extract<
				PassiveAuthCrlStatus,
				"verified_not_revoked" | "missing" | "stale"
			>;
			revocationOutcome: Extract<
				PassiveAuthRevocationOutcome,
				"verified_not_revoked" | "revocation_unknown"
			>;
			ok: true;
			algorithm: SupportedHashAlgorithm;
			signerSource: PassiveAuthSignerSource;
			sodDeclares: SodDeclares;
			source: "cms_signed_data";
	  }
	| {
			crlStatus: PassiveAuthCrlStatus;
			revocationOutcome: PassiveAuthRevocationOutcome | null;
			ok: false;
			reason: PassiveAuthFailureReason;
			detail?: string | null;
			signerSource: PassiveAuthSignerSource | null;
	  };

export type FaceScoreResult = {
	faceScore: number | null;
	passed: boolean;
	usedFallback: boolean;
	reason?: string;
};
