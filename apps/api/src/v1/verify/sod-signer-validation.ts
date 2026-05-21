import type { Certificate, SignedData } from "pkijs";
import { verifyCmsSignature } from "./cms-signature";
import { evaluateCrlStatus, verifyTrustedIssuer } from "./cms-trust-chain";
import type { PkdTrustBundle } from "./pkd-trust";
import { passiveAuthFailureResult } from "./sod-authenticity-results";
import type { ResolvedSignerCertificate } from "./sod-signer-certificates";
import type {
	AuthenticityValidationResult,
	PassiveAuthCrlStatus,
	PassiveAuthFailureReason,
	PassiveAuthRevocationOutcome,
} from "./validation-types";

type SignerCandidateEvaluation =
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
	  }
	| {
			failure: AuthenticityValidationResult;
			ok: false;
	  };

function signerValidityFailureReason(
	signerCert: Certificate,
	checkDate: Date,
): Extract<
	PassiveAuthFailureReason,
	"signer_certificate_expired" | "signer_certificate_not_yet_valid"
> | null {
	if (checkDate < signerCert.notBefore.value) {
		return "signer_certificate_not_yet_valid";
	}

	if (checkDate > signerCert.notAfter.value) {
		return "signer_certificate_expired";
	}

	return null;
}

export async function validateSignerCandidate({
	bundle,
	checkDate,
	signedData,
	signer,
}: {
	bundle: PkdTrustBundle;
	checkDate: Date;
	signedData: SignedData;
	signer: ResolvedSignerCertificate;
}): Promise<SignerCandidateEvaluation> {
	const validityFailureReason = signerValidityFailureReason(
		signer.cert,
		checkDate,
	);

	if (validityFailureReason) {
		return {
			failure: passiveAuthFailureResult({
				reason: validityFailureReason,
				signerSource: signer.signerSource,
			}),
			ok: false,
		};
	}

	const cmsSignature = await verifyCmsSignature({
		checkDate,
		signedData,
		signerCert: signer.cert,
	});

	if (!cmsSignature.ok) {
		return {
			failure: passiveAuthFailureResult({
				detail: cmsSignature.detail,
				reason: "cms_signature_invalid",
				signerSource: signer.signerSource,
			}),
			ok: false,
		};
	}

	const trustedIssuer = await verifyTrustedIssuer(bundle, signer.cert);

	if (!trustedIssuer.ok) {
		return {
			failure: passiveAuthFailureResult({
				detail: trustedIssuer.detail,
				reason: trustedIssuer.reason,
				signerSource: signer.signerSource,
			}),
			ok: false,
		};
	}

	const crlStatus = await evaluateCrlStatus({
		bundle,
		checkDate,
		issuer: trustedIssuer.issuer,
		signerCert: signer.cert,
	});

	if (crlStatus === "revoked") {
		return {
			failure: passiveAuthFailureResult({
				crlStatus,
				reason: "crl_revoked",
				revocationOutcome: "revoked",
				signerSource: signer.signerSource,
			}),
			ok: false,
		};
	}

	if (crlStatus === "missing" || crlStatus === "stale") {
		return {
			crlStatus,
			ok: true,
			revocationOutcome: "revocation_unknown",
		};
	}

	return {
		crlStatus,
		ok: true,
		revocationOutcome: "verified_not_revoked",
	};
}
