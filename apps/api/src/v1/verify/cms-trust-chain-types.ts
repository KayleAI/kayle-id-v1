import type { PkdTrustBundleCertificate } from "./pkd-trust";
import type { PassiveAuthFailureReason } from "./validation-types";

export type SignerIssuerMatchResult =
	| {
			issuer: PkdTrustBundleCertificate;
			ok: true;
	  }
	| {
			detail?: string | null;
			ok: false;
			reason: Extract<
				PassiveAuthFailureReason,
				"chain_untrusted" | "signer_certificate_invalid"
			>;
	  };
