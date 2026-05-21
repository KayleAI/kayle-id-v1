import { Certificate, type SignedData, type SignerInfo } from "pkijs";
import {
	cmsDiagnosticString,
	errorMessage,
	manualVerificationDetail,
	pkijsVerificationDetail,
} from "./cms-diagnostics";

export { createDigest } from "./cms-signature-algorithms";

import { signatureHashAlgorithm } from "./cms-signature-algorithms";
import { signedDataBytesForSignature } from "./cms-signature-bytes";

export { verifySignatureWithCertificate } from "./cms-signature-verification";

import { verifySignatureBytesWithCertificate } from "./cms-signature-verification";
import { hexBytes, relativeDistinguishedNameKey } from "./pkd-trust";
import { exactBytes } from "./sod-asn1-utils";
import { normalizedEcCertificatePublicKeyAlgorithm } from "./sod-ec-curves";

export type CmsSignatureVerificationResult = {
	detail: string | null;
	ok: boolean;
};

export function signerInfosOrThrow(
	signedData: SignedData,
): SignedData["signerInfos"] {
	if (signedData.signerInfos.length === 0) {
		throw new Error("missing_signer");
	}

	return signedData.signerInfos;
}

function signerInfoOrThrow(
	signedData: SignedData,
): SignedData["signerInfos"][number] {
	const [signerInfo] = signerInfosOrThrow(signedData);

	if (!signerInfo) {
		throw new Error("missing_signer");
	}

	return signerInfo;
}

function signedDataCertificatesWithSigner(
	signedData: SignedData,
	signerCert: Certificate,
): SignedData["certificates"] {
	const signerSubjectKey = relativeDistinguishedNameKey(signerCert.subject);
	const signerSerialNumberHex = hexBytes(
		new Uint8Array(signerCert.serialNumber.valueBlock.valueHex),
	);
	const certificates = [...(signedData.certificates ?? [])];

	for (const entry of certificates) {
		if (
			entry instanceof Certificate &&
			relativeDistinguishedNameKey(entry.subject) === signerSubjectKey &&
			hexBytes(new Uint8Array(entry.serialNumber.valueBlock.valueHex)) ===
				signerSerialNumberHex
		) {
			return certificates;
		}
	}

	return [...certificates, signerCert];
}

async function cmsPkijsFallbackResult({
	checkDate,
	manualOutcome,
	signedData,
	signerCert,
	signerInfo,
}: {
	checkDate: Date;
	manualOutcome: {
		error?: unknown;
		verified?: boolean;
	};
	signedData: SignedData;
	signerCert: Certificate;
	signerInfo: SignerInfo;
}): Promise<CmsSignatureVerificationResult> {
	const pkijsResult = await verifyCmsSignatureWithPkijs({
		checkDate,
		signedData,
		signerCert,
	});

	return {
		detail: cmsDiagnosticString({
			fallback: "pkijs",
			manual_detail: manualVerificationDetail(
				signerInfo,
				signerCert,
				manualOutcome,
			),
			pkijs_detail: pkijsResult.detail,
		}),
		ok: pkijsResult.ok,
	};
}

async function verifyCmsSignatureWithPkijs({
	checkDate,
	signedData,
	signerCert,
}: {
	checkDate: Date;
	signedData: SignedData;
	signerCert: Certificate;
}): Promise<CmsSignatureVerificationResult> {
	const signerInfo = signerInfoOrThrow(signedData);
	const originalCertificates = signedData.certificates;
	const normalizedSignerCert =
		normalizedEcCertificatePublicKeyAlgorithm(signerCert);
	signedData.certificates = signedDataCertificatesWithSigner(
		signedData,
		normalizedSignerCert,
	);

	try {
		const result = await signedData.verify({
			checkChain: false,
			checkDate,
			extendedMode: true,
			signer: 0,
		});

		return {
			detail: pkijsVerificationDetail(signerInfo, signerCert, result),
			ok: result.signatureVerified === true,
		};
	} catch (error) {
		return {
			detail: pkijsVerificationDetail(signerInfo, signerCert, {
				message: errorMessage(error),
			}),
			ok: false,
		};
	} finally {
		signedData.certificates = originalCertificates;
	}
}

export async function verifyCmsSignature({
	checkDate,
	signedData,
	signerCert,
}: {
	checkDate: Date;
	signedData: SignedData;
	signerCert: Certificate;
}): Promise<CmsSignatureVerificationResult> {
	const signerInfo = signerInfoOrThrow(signedData);

	if (signerInfo.signedAttrs) {
		try {
			const manualVerified = await verifyCmsSignatureManually({
				signedData,
				signerCert,
			});

			if (manualVerified) {
				return {
					detail: manualVerificationDetail(signerInfo, signerCert, {
						verified: true,
					}),
					ok: true,
				};
			}

			return cmsPkijsFallbackResult({
				checkDate,
				manualOutcome: {
					verified: false,
				},
				signedData,
				signerCert,
				signerInfo,
			});
		} catch (error) {
			return cmsPkijsFallbackResult({
				checkDate,
				manualOutcome: {
					error,
				},
				signedData,
				signerCert,
				signerInfo,
			});
		}
	}

	return verifyCmsSignatureWithPkijs({
		checkDate,
		signedData,
		signerCert,
	});
}

async function verifyCmsSignatureManually({
	signedData,
	signerCert,
}: {
	signedData: SignedData;
	signerCert: Certificate;
}): Promise<boolean> {
	const signerInfo = signerInfoOrThrow(signedData);
	const hashAlgorithm = signatureHashAlgorithm(signerInfo);

	if (!hashAlgorithm) {
		throw new Error("cms_signature_digest_algorithm_invalid");
	}

	const signedBytes = await signedDataBytesForSignature({
		signedData,
		signerInfo,
	});
	const rawSignatureBytes = exactBytes(
		signerInfo.signature.valueBlock.valueHexView,
	);

	return verifySignatureBytesWithCertificate({
		data: signedBytes,
		hashAlgorithm,
		publicKeyCert: signerCert,
		signatureAlgorithm: signerInfo.signatureAlgorithm,
		signatureBytes: rawSignatureBytes,
	});
}
