export type AppAttestEnvironment = "production" | "development";

export type AttestationFailureReason =
	| "cbor_decode_failed"
	| "fmt_unexpected"
	| "x5c_missing"
	| "cert_parse_failed"
	| "cert_chain_invalid"
	| "auth_data_truncated"
	| "rp_id_hash_mismatch"
	| "counter_not_zero"
	| "aaguid_mismatch"
	| "key_id_mismatch"
	| "nonce_extension_missing"
	| "nonce_mismatch"
	| "credential_id_mismatch"
	| "cose_public_key_invalid"
	| "receipt_missing";

export type AssertionFailureReason =
	| "cbor_decode_failed"
	| "auth_data_truncated"
	| "rp_id_hash_mismatch"
	| "counter_regressed"
	| "signature_decode_failed"
	| "signature_invalid"
	| "public_key_invalid";

export type AttestationVerificationResult =
	| {
			ok: true;
			publicKeyCose: Uint8Array;
			receipt: Uint8Array;
			counter: number;
	  }
	| { ok: false; reason: AttestationFailureReason; detail?: string };

export type AssertionVerificationResult =
	| { ok: true; counter: number }
	| { ok: false; reason: AssertionFailureReason; detail?: string };
