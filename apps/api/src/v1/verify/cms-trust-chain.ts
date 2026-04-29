import type { AlgorithmIdentifier, Certificate } from "pkijs";
import {
	cmsDiagnosticString,
	errorMessage,
	issuerVerificationDetail,
} from "./cms-diagnostics";
import { verifySignatureWithCertificate } from "./cms-signature";
import {
	authorityKeyIdentifierHex,
	hexBytes,
	type PkdTrustBundle,
	type PkdTrustBundleCertificate,
	type PkdTrustBundleCrl,
	relativeDistinguishedNameKey,
	subjectKeyIdentifierHexOrKeyHash,
} from "./pkd-trust";
import { exactBytes } from "./sod-asn1-utils";
import { normalizedEcCertificatePublicKeyAlgorithm } from "./sod-ec-curves";
import type {
	PassiveAuthCrlStatus,
	PassiveAuthFailureReason,
} from "./validation-types";

type CrlVerificationState = "current_verified" | "stale_verified";

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

async function verifyCertificateIssuedBy({
	issuerCert,
	certificate,
}: {
	issuerCert: Certificate;
	certificate: Certificate;
}): Promise<{
	detail: string | null;
	ok: boolean;
}> {
	const normalizedCertificate =
		normalizedEcCertificatePublicKeyAlgorithm(certificate);
	const normalizedIssuerCert =
		normalizedEcCertificatePublicKeyAlgorithm(issuerCert);

	let pkijsDetail: string | null = null;

	try {
		const pkijsVerified =
			await normalizedCertificate.verify(normalizedIssuerCert);

		if (pkijsVerified) {
			return {
				detail: null,
				ok: true,
			};
		}

		pkijsDetail = "pkijs=false";
	} catch (error) {
		pkijsDetail = errorMessage(error);
	}

	try {
		const manualVerified = await verifySignatureWithCertificate({
			data: exactBytes(normalizedCertificate.tbsView),
			publicKeyCert: normalizedIssuerCert,
			signatureAlgorithm:
				normalizedCertificate.signatureAlgorithm as AlgorithmIdentifier,
			signatureBytes: exactBytes(
				normalizedCertificate.signatureValue.valueBlock.valueHexView,
			),
		});

		return {
			detail: manualVerified
				? null
				: issuerVerificationDetail({
						manual: "manual=false",
						pkijs: pkijsDetail,
						serialNumberHex: hexBytes(
							new Uint8Array(certificate.serialNumber.valueBlock.valueHex),
						),
					}),
			ok: manualVerified,
		};
	} catch (error) {
		return {
			detail: issuerVerificationDetail({
				manual: errorMessage(error),
				pkijs: pkijsDetail,
				serialNumberHex: hexBytes(
					new Uint8Array(certificate.serialNumber.valueBlock.valueHex),
				),
			}),
			ok: false,
		};
	}
}

function collectTrustedIssuerCandidates(
	bundle: PkdTrustBundle,
	signerCert: Certificate,
): PkdTrustBundleCertificate[] {
	const issuerKey = relativeDistinguishedNameKey(signerCert.issuer);
	const signerAkiHex = authorityKeyIdentifierHex(signerCert);
	const deduped = new Map<string, PkdTrustBundleCertificate>();

	for (const candidate of bundle.cscasBySubjectKey.get(issuerKey) ?? []) {
		deduped.set(candidate.record.derBase64, candidate);
	}

	if (signerAkiHex) {
		for (const candidate of bundle.cscasBySkiHex.get(signerAkiHex) ?? []) {
			deduped.set(candidate.record.derBase64, candidate);
		}
	}

	return [...deduped.values()];
}

export async function verifyTrustedIssuer(
	bundle: PkdTrustBundle,
	signerCert: Certificate,
): Promise<SignerIssuerMatchResult> {
	const candidates = collectTrustedIssuerCandidates(bundle, signerCert);

	if (candidates.length === 0) {
		return {
			detail: cmsDiagnosticString({
				issuer_aki: authorityKeyIdentifierHex(signerCert),
				issuer_candidates: 0,
			}),
			ok: false,
			reason: "chain_untrusted",
		};
	}

	const failureDetails: string[] = [];

	for (const candidate of candidates) {
		const verification = await verifyCertificateIssuedBy({
			certificate: signerCert,
			issuerCert: candidate.cert,
		});

		if (verification.ok) {
			return {
				issuer: candidate,
				ok: true,
			};
		}

		if (verification.detail) {
			failureDetails.push(verification.detail);
		}
	}

	return {
		detail: failureDetails.join("||") || null,
		ok: false,
		reason: "signer_certificate_invalid",
	};
}

function dedupeCrlEntries(
	entries: Iterable<PkdTrustBundleCrl>,
): PkdTrustBundleCrl[] {
	const deduped = new Map<string, PkdTrustBundleCrl>();

	for (const entry of entries) {
		deduped.set(entry.record.derBase64, entry);
	}

	return [...deduped.values()];
}

async function collectIssuerCrlCandidates({
	bundle,
	issuer,
}: {
	bundle: PkdTrustBundle;
	issuer: PkdTrustBundleCertificate;
}): Promise<PkdTrustBundleCrl[]> {
	const issuerSkiHex =
		issuer.record.skiHex ??
		(await subjectKeyIdentifierHexOrKeyHash(issuer.cert));

	return dedupeCrlEntries([
		...(bundle.crlsByIssuerKey.get(issuer.record.subjectKey) ?? []),
		...(issuerSkiHex ? (bundle.crlsByAkiHex.get(issuerSkiHex) ?? []) : []),
	]);
}

function crlIsStale(candidate: PkdTrustBundleCrl, checkDate: Date): boolean {
	return Boolean(
		candidate.crl.nextUpdate?.value &&
			candidate.crl.nextUpdate.value < checkDate,
	);
}

function crlIsNotYetUsable(
	candidate: PkdTrustBundleCrl,
	checkDate: Date,
): boolean {
	return candidate.crl.thisUpdate.value > checkDate;
}

async function verifyCrlForIssuer({
	candidate,
	issuer,
}: {
	candidate: PkdTrustBundleCrl;
	issuer: PkdTrustBundleCertificate;
}): Promise<boolean> {
	const normalizedIssuerCert = normalizedEcCertificatePublicKeyAlgorithm(
		issuer.cert,
	);

	try {
		return await candidate.crl.verify({
			issuerCertificate: normalizedIssuerCert,
		});
	} catch {
		try {
			return await verifySignatureWithCertificate({
				data: exactBytes(candidate.crl.tbsView),
				publicKeyCert: normalizedIssuerCert,
				signatureAlgorithm: candidate.crl
					.signatureAlgorithm as AlgorithmIdentifier,
				signatureBytes: exactBytes(
					candidate.crl.signatureValue.valueBlock.valueHexView,
				),
			});
		} catch {
			return false;
		}
	}
}

export async function evaluateCrlStatus({
	bundle,
	checkDate,
	issuer,
	signerCert,
}: {
	bundle: PkdTrustBundle;
	checkDate: Date;
	issuer: PkdTrustBundleCertificate;
	signerCert: Certificate;
}): Promise<Exclude<PassiveAuthCrlStatus, "not_checked">> {
	const candidates = await collectIssuerCrlCandidates({
		bundle,
		issuer,
	});

	if (candidates.length === 0) {
		return "soft_fail_missing";
	}

	const verifiedCandidates: Array<{
		candidate: PkdTrustBundleCrl;
		state: CrlVerificationState;
	}> = [];

	for (const candidate of candidates) {
		if (crlIsNotYetUsable(candidate, checkDate)) {
			continue;
		}

		if (
			!(await verifyCrlForIssuer({
				candidate,
				issuer,
			}))
		) {
			continue;
		}

		verifiedCandidates.push({
			candidate,
			state: crlIsStale(candidate, checkDate)
				? "stale_verified"
				: "current_verified",
		});
	}

	const currentVerifiedCandidates = verifiedCandidates
		.filter((entry) => entry.state === "current_verified")
		.map((entry) => entry.candidate)
		.sort((left, right) => {
			const thisUpdateDelta =
				right.crl.thisUpdate.value.getTime() -
				left.crl.thisUpdate.value.getTime();

			if (thisUpdateDelta !== 0) {
				return thisUpdateDelta;
			}

			const leftNextUpdate = left.crl.nextUpdate?.value.getTime() ?? -1;
			const rightNextUpdate = right.crl.nextUpdate?.value.getTime() ?? -1;
			const nextUpdateDelta = rightNextUpdate - leftNextUpdate;

			if (nextUpdateDelta !== 0) {
				return nextUpdateDelta;
			}

			return left.record.derBase64.localeCompare(right.record.derBase64);
		});

	if (currentVerifiedCandidates.length > 0) {
		for (const candidate of currentVerifiedCandidates) {
			if (candidate.crl.isCertificateRevoked(signerCert)) {
				return "revoked";
			}
		}

		return "verified_not_revoked";
	}

	return verifiedCandidates.some((entry) => entry.state === "stale_verified")
		? "soft_fail_stale"
		: "soft_fail_missing";
}
