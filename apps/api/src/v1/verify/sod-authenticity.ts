import { OctetString } from "asn1js";
import { Certificate, IssuerAndSerialNumber, type SignedData } from "pkijs";
import {
	createDigest,
	signerInfosOrThrow,
	verifyCmsSignature,
} from "./cms-signature";
import { evaluateCrlStatus, verifyTrustedIssuer } from "./cms-trust-chain";
import {
	hexBytes,
	loadPkdTrustBundle,
	type PkdTrustBundle,
	relativeDistinguishedNameKey,
	resolvePkdDscCertificate,
	resolvePkdDscCertificatesBySki,
	subjectKeyIdentifierHex,
} from "./pkd-trust";
import { bytesEqual, exactBytes, octetStringBytes } from "./sod-asn1-utils";
import {
	type ParsedSodSecurityObject,
	parseSodSecurityObject,
} from "./sod-parser";
import type {
	AuthenticityValidationResult,
	PassiveAuthCrlStatus,
	PassiveAuthFailureReason,
	PassiveAuthSignerSource,
} from "./validation-types";

type ResolvedSignerCertificate = {
	cert: Certificate;
	signerSource: PassiveAuthSignerSource;
};

function issuerAndSerialFromSignerInfo(
	signerInfo: SignedData["signerInfos"][number],
): {
	issuerKey: string;
	serialNumberHex: string;
} | null {
	if (!(signerInfo.sid instanceof IssuerAndSerialNumber)) {
		return null;
	}

	return {
		issuerKey: relativeDistinguishedNameKey(signerInfo.sid.issuer),
		serialNumberHex: hexBytes(
			new Uint8Array(signerInfo.sid.serialNumber.valueBlock.valueHex),
		),
	};
}

function subjectKeyIdentifierFromSignerInfo(
	signerInfo: SignedData["signerInfos"][number],
): string | null {
	if (signerInfo.sid instanceof OctetString) {
		return hexBytes(octetStringBytes(signerInfo.sid));
	}

	const contextSpecificSid = signerInfo.sid as {
		idBlock?: {
			tagClass?: number;
			tagNumber?: number;
		};
		valueBlock?: {
			value?: unknown[];
			valueHex?: ArrayBuffer;
			valueHexView?: Uint8Array;
		};
	};

	if (
		contextSpecificSid.idBlock?.tagClass !== 3 ||
		contextSpecificSid.idBlock?.tagNumber !== 0
	) {
		return null;
	}

	const [nestedValue] = contextSpecificSid.valueBlock?.value ?? [];

	if (nestedValue instanceof OctetString) {
		return hexBytes(octetStringBytes(nestedValue));
	}

	if (contextSpecificSid.valueBlock?.valueHexView) {
		return hexBytes(exactBytes(contextSpecificSid.valueBlock.valueHexView));
	}

	if (contextSpecificSid.valueBlock?.valueHex) {
		return hexBytes(new Uint8Array(contextSpecificSid.valueBlock.valueHex));
	}

	return null;
}

function embeddedCertificates(signedData: SignedData): Certificate[] {
	return (
		signedData.certificates?.filter(
			(entry): entry is Certificate => entry instanceof Certificate,
		) ?? []
	);
}

async function certificateMatchesSigner(
	cert: Certificate,
	signerInfo: SignedData["signerInfos"][number],
): Promise<boolean> {
	if (signerInfo.sid instanceof IssuerAndSerialNumber) {
		const signerIdentifier = issuerAndSerialFromSignerInfo(signerInfo);

		return (
			signerIdentifier !== null &&
			relativeDistinguishedNameKey(cert.issuer) ===
				signerIdentifier.issuerKey &&
			hexBytes(new Uint8Array(cert.serialNumber.valueBlock.valueHex)) ===
				signerIdentifier.serialNumberHex
		);
	}

	const signerSkiHex = subjectKeyIdentifierFromSignerInfo(signerInfo);

	if (!signerSkiHex) {
		return false;
	}

	const certSkiHex = await subjectKeyIdentifierHex(cert);

	return certSkiHex === signerSkiHex;
}

function certificateIssuerSerialKey(cert: Certificate): string {
	return `${relativeDistinguishedNameKey(cert.issuer)}:${hexBytes(
		new Uint8Array(cert.serialNumber.valueBlock.valueHex),
	)}`;
}

function dedupeResolvedSignerCertificates(
	candidates: ResolvedSignerCertificate[],
): ResolvedSignerCertificate[] {
	const deduped = new Map<string, ResolvedSignerCertificate>();

	for (const candidate of candidates) {
		const key = `${candidate.signerSource}:${certificateIssuerSerialKey(
			candidate.cert,
		)}`;

		if (!deduped.has(key)) {
			deduped.set(key, candidate);
		}
	}

	return [...deduped.values()];
}

async function resolveSignerCertificates({
	bundle,
	signedData,
	signerInfo,
}: {
	bundle: PkdTrustBundle | null;
	signedData: SignedData;
	signerInfo: SignedData["signerInfos"][number];
}): Promise<ResolvedSignerCertificate[]> {
	const candidates: ResolvedSignerCertificate[] = [];

	for (const cert of embeddedCertificates(signedData)) {
		if (await certificateMatchesSigner(cert, signerInfo)) {
			candidates.push({
				cert,
				signerSource: "sod",
			});
		}
	}

	if (!bundle) {
		return candidates;
	}

	const signerIdentifier = issuerAndSerialFromSignerInfo(signerInfo);
	const subjectKeyIdentifier = subjectKeyIdentifierFromSignerInfo(signerInfo);

	if (signerIdentifier) {
		const dsc = await resolvePkdDscCertificate(
			bundle,
			signerIdentifier.issuerKey,
			signerIdentifier.serialNumberHex,
		);

		if (dsc) {
			candidates.push({
				cert: dsc.cert,
				signerSource: "bundle",
			});
		}
	}

	if (subjectKeyIdentifier) {
		for (const dsc of await resolvePkdDscCertificatesBySki(
			bundle,
			subjectKeyIdentifier,
		)) {
			candidates.push({
				cert: dsc.cert,
				signerSource: "bundle",
			});
		}
	}

	return dedupeResolvedSignerCertificates(candidates);
}

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

function normalizeFailureReason(error: unknown): PassiveAuthFailureReason {
	const reason = error instanceof Error ? error.message : "";

	if (reason === "required_dg_hash_missing") {
		return "required_dg_hash_missing";
	}

	if (reason === "unsupported_digest_algorithm") {
		return "unsupported_digest_algorithm";
	}

	return "parse_failure";
}

function failureResult({
	crlStatus = "not_checked",
	detail = null,
	reason,
	signerSource = null,
}: {
	crlStatus?: PassiveAuthCrlStatus;
	detail?: string | null;
	reason: PassiveAuthFailureReason;
	signerSource?: PassiveAuthSignerSource | null;
}): AuthenticityValidationResult {
	return {
		crlStatus,
		detail,
		ok: false,
		reason,
		signerSource,
	};
}

async function validateSignerCandidate({
	bundle,
	checkDate,
	signedData,
	signer,
}: {
	bundle: PkdTrustBundle;
	checkDate: Date;
	signedData: SignedData;
	signer: ResolvedSignerCertificate;
}): Promise<
	| {
			crlStatus: Exclude<PassiveAuthCrlStatus, "not_checked" | "revoked">;
			ok: true;
	  }
	| {
			failure: AuthenticityValidationResult;
			ok: false;
	  }
> {
	const validityFailureReason = signerValidityFailureReason(
		signer.cert,
		checkDate,
	);

	if (validityFailureReason) {
		return {
			failure: failureResult({
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
			failure: failureResult({
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
			failure: failureResult({
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
			failure: failureResult({
				crlStatus,
				reason: "crl_revoked",
				signerSource: signer.signerSource,
			}),
			ok: false,
		};
	}

	return {
		crlStatus,
		ok: true,
	};
}

async function verifyOptionalDgHash({
	algorithm,
	bytes,
	dataGroupNumber,
	dgHashes,
}: {
	algorithm: ParsedSodSecurityObject["algorithm"];
	bytes: Uint8Array | undefined;
	dataGroupNumber: number;
	dgHashes: Map<number, Uint8Array>;
}): Promise<boolean> {
	if (!bytes || bytes.length === 0) {
		return true;
	}

	const expectedHash = dgHashes.get(dataGroupNumber);

	if (!expectedHash) {
		return false;
	}

	const actualHash = await createDigest(algorithm, bytes);
	return bytesEqual(actualHash, expectedHash);
}

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
		return failureResult({
			reason: "missing_required_artifacts",
		});
	}

	let parsed: ParsedSodSecurityObject;

	try {
		parsed = parseSodSecurityObject(sod);
	} catch (error) {
		return failureResult({
			reason: normalizeFailureReason(error),
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
		return failureResult({
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
		return failureResult({
			reason: "dg_hash_mismatch",
		});
	}

	const [dg14Verified, dg15Verified] = await Promise.all([
		verifyOptionalDgHash({
			algorithm: parsed.algorithm,
			bytes: dg14,
			dataGroupNumber: 14,
			dgHashes: parsed.dgHashes,
		}),
		verifyOptionalDgHash({
			algorithm: parsed.algorithm,
			bytes: dg15,
			dataGroupNumber: 15,
			dgHashes: parsed.dgHashes,
		}),
	]);

	if (!(dg14Verified && dg15Verified)) {
		return failureResult({
			reason: "dg_hash_mismatch",
		});
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
		return failureResult({
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
		return failureResult({
			reason: "signer_certificate_invalid",
		});
	}

	if (signerCandidates.length === 0) {
		return failureResult({
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
			signerSource: signer.signerSource,
			source: "cms_signed_data",
		};
	}

	return (
		candidateFailure ??
		failureResult({
			reason: "signer_certificate_invalid",
		})
	);
}
