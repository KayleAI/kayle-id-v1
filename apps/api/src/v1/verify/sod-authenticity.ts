import type { SignedData } from "pkijs";
import { createDigest, signerInfosOrThrow } from "./cms-signature";
import { loadPkdTrustBundle, type PkdTrustBundle } from "./pkd-trust";
import { bytesEqual } from "./sod-asn1-utils";
import {
	normalizeSodFailureReason,
	passiveAuthFailureResult,
} from "./sod-authenticity-results";
import { checkOptionalDg } from "./sod-dg-hashes";
import {
	type ParsedSodSecurityObject,
	parseSodSecurityObject,
} from "./sod-parser";
import {
	type ResolvedSignerCertificate,
	resolveSignerCertificates,
} from "./sod-signer-certificates";
import { validateSignerCandidate } from "./sod-signer-validation";
import type { AuthenticityValidationResult } from "./validation-types";

export async function validateAuthenticity({
	checkDate = new Date(),
	dg1,
	dg2,
	dg14,
	dg15,
	sod,
	trustBundle,
}: {
	checkDate?: Date;
	dg1: Uint8Array;
	dg2: Uint8Array;
	dg14?: Uint8Array;
	dg15?: Uint8Array;
	sod: Uint8Array;
	trustBundle?: PkdTrustBundle;
}): Promise<AuthenticityValidationResult> {
	if (!(dg1.length && dg2.length && sod.length)) {
		return passiveAuthFailureResult({
			reason: "missing_required_artifacts",
		});
	}

	let parsed: ParsedSodSecurityObject;

	try {
		parsed = parseSodSecurityObject(sod);
	} catch (error) {
		return passiveAuthFailureResult({
			reason: normalizeSodFailureReason(error),
		});
	}

	const signerInfos: SignedData["signerInfos"] | Error = (() => {
		try {
			return signerInfosOrThrow(parsed.signedData);
		} catch (error) {
			return error instanceof Error ? error : new Error("missing_signer");
		}
	})();

	if (signerInfos instanceof Error) {
		return passiveAuthFailureResult({
			reason: "missing_signer",
		});
	}

	const [dg1Digest, dg2Digest] = await Promise.all([
		createDigest(parsed.algorithm, dg1),
		createDigest(parsed.algorithm, dg2),
	]);

	if (
		!(
			bytesEqual(dg1Digest, parsed.dg1Hash) &&
			bytesEqual(dg2Digest, parsed.dg2Hash)
		)
	) {
		return passiveAuthFailureResult({
			reason: "dg_hash_mismatch",
		});
	}

	const [dg14Check, dg15Check] = await Promise.all([
		checkOptionalDg({
			algorithm: parsed.algorithm,
			bytes: dg14,
			dataGroupNumber: 14,
			dgHashes: parsed.dgHashes,
		}),
		checkOptionalDg({
			algorithm: parsed.algorithm,
			bytes: dg15,
			dataGroupNumber: 15,
			dgHashes: parsed.dgHashes,
		}),
	]);

	if (!dg14Check.ok) {
		return passiveAuthFailureResult({ reason: dg14Check.reason });
	}

	if (!dg15Check.ok) {
		return passiveAuthFailureResult({ reason: dg15Check.reason });
	}

	const bundle = (() => {
		if (trustBundle) {
			return Promise.resolve(trustBundle);
		}

		return loadPkdTrustBundle();
	})();

	let resolvedTrustBundle: PkdTrustBundle | null;

	try {
		resolvedTrustBundle = await bundle;
	} catch {
		resolvedTrustBundle = null;
	}

	if (!resolvedTrustBundle) {
		return passiveAuthFailureResult({
			reason: "trust_bundle_unavailable",
		});
	}

	let signerCandidates: ResolvedSignerCertificate[];

	try {
		signerCandidates = await resolveSignerCertificates({
			bundle: resolvedTrustBundle,
			signedData: parsed.signedData,
			signerInfo: signerInfos[0],
		});
	} catch {
		return passiveAuthFailureResult({
			reason: "signer_certificate_invalid",
		});
	}

	if (signerCandidates.length === 0) {
		return passiveAuthFailureResult({
			reason: "missing_signer_certificate",
		});
	}

	let candidateFailure: AuthenticityValidationResult | null = null;

	for (const signer of signerCandidates) {
		const evaluation = await validateSignerCandidate({
			bundle: resolvedTrustBundle,
			checkDate,
			signedData: parsed.signedData,
			signer,
		});

		if (!evaluation.ok) {
			candidateFailure ??= evaluation.failure;
			continue;
		}

		return {
			algorithm: parsed.algorithm,
			crlStatus: evaluation.crlStatus,
			ok: true,
			revocationOutcome: evaluation.revocationOutcome,
			signerSource: signer.signerSource,
			sodDeclares: {
				dg14: parsed.dgHashes.has(14),
				dg15: parsed.dgHashes.has(15),
			},
			source: "cms_signed_data",
		};
	}

	return (
		candidateFailure ??
		passiveAuthFailureResult({
			reason: "signer_certificate_invalid",
		})
	);
}
