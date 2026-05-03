export type SupportedHashAlgorithm =
	| "SHA-256"
	| "SHA-384"
	| "SHA-512"
	| "SHA-1";

export type SupportedImageFormat = "jpeg" | "jpeg2000";

export type PassiveAuthCrlStatus =
	| "not_checked"
	| "revoked"
	| "soft_fail_missing"
	| "soft_fail_stale"
	| "verified_not_revoked";

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

export type DecodedImage = {
	width: number;
	height: number;
	rgba: Uint8ClampedArray;
};

export type Dg2FaceImage = {
	imageData: Uint8Array;
	imageFormat: SupportedImageFormat;
	imageWidth: number;
	imageHeight: number;
};

export const DEFAULT_FACE_MATCH_THRESHOLD = 0.8;

export type SodDeclares = {
	dg14: boolean;
	dg15: boolean;
};

export type Dg14Declares = {
	chipAuthentication: boolean;
};

export type AuthenticityValidationResult =
	| {
			crlStatus: Exclude<PassiveAuthCrlStatus, "not_checked" | "revoked">;
			ok: true;
			algorithm: SupportedHashAlgorithm;
			signerSource: PassiveAuthSignerSource;
			sodDeclares: SodDeclares;
			source: "cms_signed_data";
	  }
	| {
			crlStatus: PassiveAuthCrlStatus;
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
