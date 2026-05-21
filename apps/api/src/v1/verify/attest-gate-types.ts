export type AttestGateOutcome =
	| { counter: number; ok: true }
	| {
			code:
				| "HELLO_ATTEST_KEY_UNKNOWN"
				| "HELLO_ATTEST_INVALID"
				| "document_anti_cloning_attestation_failed";
			detail?: string;
			ok: false;
	  };
