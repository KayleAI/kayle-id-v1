import type { AlgorithmIdentifier, Certificate } from "pkijs";
import {
	cmsDiagnosticString,
	errorMessage,
	issuerVerificationDetail,
} from "./cms-diagnostics";
import { verifySignatureWithCertificate } from "./cms-signature";
import type { SignerIssuerMatchResult } from "./cms-trust-chain-types";
import {
	authorityKeyIdentifierHex,
	hexBytes,
	type PkdTrustBundle,
	type PkdTrustBundleCertificate,
	relativeDistinguishedNameKey,
} from "./pkd-trust";
import { exactBytes } from "./sod-asn1-utils";
import { normalizedEcCertificatePublicKeyAlgorithm } from "./sod-ec-curves";

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
