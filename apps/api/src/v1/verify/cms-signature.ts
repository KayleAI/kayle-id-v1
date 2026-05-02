import { OctetString } from "asn1js";
import {
	type AlgorithmIdentifier,
	Certificate,
	getHashAlgorithm,
	RSASSAPSSParams,
	type SignedData,
	type SignerInfo,
} from "pkijs";
import {
	cmsDiagnosticString,
	errorMessage,
	manualVerificationDetail,
	pkijsVerificationDetail,
} from "./cms-diagnostics";
import { hexBytes, relativeDistinguishedNameKey } from "./pkd-trust";
import {
	bufferBytes,
	bytesEqual,
	exactBytes,
	octetStringBytes,
	subtleAlgorithmFromOid,
} from "./sod-asn1-utils";
import {
	CONTENT_TYPE_ATTRIBUTE_OID,
	ECDSA_PUBLIC_KEY_OID,
	MESSAGE_DIGEST_ATTRIBUTE_OID,
	RSA_ENCRYPTION_OID,
	RSA_PSS_OID,
	SUPPORTED_NAMED_CURVES,
} from "./sod-constants";
import {
	ecdsaSignatureBytes,
	normalizedEcCertificatePublicKeyAlgorithm,
	signerEcNamedCurve,
} from "./sod-ec-curves";
import type { SupportedHashAlgorithm } from "./validation-types";

export type CmsSignatureVerificationResult = {
	detail: string | null;
	ok: boolean;
};

export async function createDigest(
	algorithm: SupportedHashAlgorithm,
	data: Uint8Array,
): Promise<Uint8Array> {
	return new Uint8Array(
		await crypto.subtle.digest(algorithm, bufferBytes(data)),
	);
}

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

function parseSupportedHashAlgorithmName(
	algorithmName: string | null,
): SupportedHashAlgorithm | null {
	switch (algorithmName) {
		case "SHA-1":
		case "SHA-256":
		case "SHA-384":
		case "SHA-512":
			return algorithmName;
		default:
			return null;
	}
}

function signerDigestAlgorithm(
	signerInfo: SignerInfo,
): SupportedHashAlgorithm | null {
	return subtleAlgorithmFromOid(signerInfo.digestAlgorithm.algorithmId);
}

function signatureHashAlgorithm(
	signerInfo: SignerInfo,
): SupportedHashAlgorithm | null {
	const algorithmFromSignature = parseSupportedHashAlgorithmName(
		getHashAlgorithm(signerInfo.signatureAlgorithm) || null,
	);

	return algorithmFromSignature ?? signerDigestAlgorithm(signerInfo);
}

function algorithmIdentifierHashAlgorithm(
	signatureAlgorithm: AlgorithmIdentifier,
): SupportedHashAlgorithm | null {
	return parseSupportedHashAlgorithmName(
		getHashAlgorithm(signatureAlgorithm) || null,
	);
}

function encapsulatedContentBytes(signedData: SignedData): Uint8Array {
	const eContent = signedData.encapContentInfo.eContent;

	if (!eContent) {
		throw new Error("cms_content_missing");
	}

	if (eContent.idBlock.tagClass === 1 && eContent.idBlock.tagNumber === 4) {
		return exactBytes(new Uint8Array(eContent.getValue()));
	}

	return exactBytes(eContent.valueBlock.valueBeforeDecodeView);
}

function signedAttributeMessageDigest(
	signerInfo: SignerInfo,
): Uint8Array | null {
	if (!signerInfo.signedAttrs) {
		return null;
	}

	let sawContentType = false;
	let messageDigest: Uint8Array | null = null;

	for (const attribute of signerInfo.signedAttrs.attributes) {
		if (attribute.type === CONTENT_TYPE_ATTRIBUTE_OID) {
			sawContentType = true;
			continue;
		}

		if (attribute.type !== MESSAGE_DIGEST_ATTRIBUTE_OID) {
			continue;
		}

		const [digestValue] = attribute.values;

		if (!(digestValue instanceof OctetString)) {
			throw new Error("cms_signed_attributes_invalid");
		}

		messageDigest = octetStringBytes(digestValue);
	}

	if (!(sawContentType && messageDigest)) {
		throw new Error("cms_signed_attributes_invalid");
	}

	return messageDigest;
}

function signedAttributesSignatureBytes(signerInfo: SignerInfo): Uint8Array {
	if (!signerInfo.signedAttrs) {
		throw new Error("cms_signed_attributes_invalid");
	}

	const signedAttributesBytes = exactBytes(
		new Uint8Array(signerInfo.signedAttrs.encodedValue),
	);

	if (signedAttributesBytes[0] === 0xa0) {
		signedAttributesBytes[0] = 0x31;
	}

	return signedAttributesBytes;
}

async function signedDataBytesForSignature({
	signedData,
	signerInfo,
}: {
	signedData: SignedData;
	signerInfo: SignerInfo;
}): Promise<Uint8Array> {
	if (!signerInfo.signedAttrs) {
		return encapsulatedContentBytes(signedData);
	}

	const digestAlgorithm = signerDigestAlgorithm(signerInfo);

	if (!digestAlgorithm) {
		throw new Error("cms_signature_digest_algorithm_invalid");
	}

	const expectedMessageDigest = signedAttributeMessageDigest(signerInfo);

	if (!expectedMessageDigest) {
		throw new Error("cms_signed_attributes_invalid");
	}

	const actualMessageDigest = await createDigest(
		digestAlgorithm,
		encapsulatedContentBytes(signedData),
	);

	if (!bytesEqual(actualMessageDigest, expectedMessageDigest)) {
		throw new Error("cms_signed_attributes_digest_mismatch");
	}

	return signedAttributesSignatureBytes(signerInfo);
}

function importSignerVerificationKey({
	hashAlgorithm,
	signatureAlgorithm,
	signerCert,
}: {
	hashAlgorithm: SupportedHashAlgorithm;
	signatureAlgorithm: SignerInfo["signatureAlgorithm"];
	signerCert: Certificate;
}): Promise<CryptoKey> {
	if (signatureAlgorithm.algorithmId === RSA_PSS_OID) {
		const spkiBytes = signerCert.subjectPublicKeyInfo.toSchema().toBER(false);

		return crypto.subtle.importKey(
			"spki",
			spkiBytes,
			{
				name: "RSA-PSS",
				hash: hashAlgorithm,
			},
			true,
			["verify"],
		);
	}

	const publicKeyAlgorithm = signerCert.subjectPublicKeyInfo.algorithm;
	const publicKeyAlgorithmId = publicKeyAlgorithm.algorithmId;

	if (publicKeyAlgorithmId === RSA_ENCRYPTION_OID) {
		const spkiBytes = signerCert.subjectPublicKeyInfo.toSchema().toBER(false);

		return crypto.subtle.importKey(
			"spki",
			spkiBytes,
			{
				name: "RSASSA-PKCS1-v1_5",
				hash: hashAlgorithm,
			},
			true,
			["verify"],
		);
	}

	if (publicKeyAlgorithmId === ECDSA_PUBLIC_KEY_OID) {
		const namedCurve = signerEcNamedCurve(signerCert);
		const spkiBytes = normalizedEcCertificatePublicKeyAlgorithm(signerCert)
			.subjectPublicKeyInfo.toSchema()
			.toBER(false);

		return crypto.subtle.importKey(
			"spki",
			spkiBytes,
			{
				name: "ECDSA",
				namedCurve,
			},
			true,
			["verify"],
		);
	}

	throw new Error("cms_signature_algorithm_unsupported");
}

function signatureVerificationParams({
	hashAlgorithm,
	signatureAlgorithm,
	signerCert,
}: {
	hashAlgorithm: SupportedHashAlgorithm;
	signatureAlgorithm: SignerInfo["signatureAlgorithm"];
	signerCert: Certificate;
}) {
	if (signatureAlgorithm.algorithmId === RSA_PSS_OID) {
		const params = new RSASSAPSSParams({
			schema: signatureAlgorithm.algorithmParams,
		});

		return {
			name: "RSA-PSS",
			hash:
				parseSupportedHashAlgorithmName(
					getHashAlgorithm(params.hashAlgorithm) || null,
				) ?? hashAlgorithm,
			saltLength: params.saltLength ?? 20,
		};
	}

	if (
		signerCert.subjectPublicKeyInfo.algorithm.algorithmId === RSA_ENCRYPTION_OID
	) {
		return {
			name: "RSASSA-PKCS1-v1_5",
			hash: hashAlgorithm,
		};
	}

	return {
		name: "ECDSA",
		hash: hashAlgorithm,
	};
}

export async function verifySignatureWithCertificate({
	data,
	publicKeyCert,
	signatureAlgorithm,
	signatureBytes,
}: {
	data: Uint8Array;
	publicKeyCert: Certificate;
	signatureAlgorithm: AlgorithmIdentifier;
	signatureBytes: Uint8Array;
}): Promise<boolean> {
	const hashAlgorithm = algorithmIdentifierHashAlgorithm(signatureAlgorithm);

	if (!hashAlgorithm) {
		throw new Error("signature_digest_algorithm_invalid");
	}

	const verificationKey = await importSignerVerificationKey({
		hashAlgorithm,
		signatureAlgorithm,
		signerCert: publicKeyCert,
	});
	const verificationParams = signatureVerificationParams({
		hashAlgorithm,
		signatureAlgorithm,
		signerCert: publicKeyCert,
	});
	const namedCurve =
		verificationKey.algorithm.name === "ECDSA"
			? namedCurveFromKeyAlgorithm(verificationKey.algorithm)
			: null;
	const normalizedSignatureBytes = namedCurve
		? ecdsaSignatureBytes({
				namedCurve,
				signatureBytes,
			})
		: signatureBytes;

	return crypto.subtle.verify(
		verificationParams,
		verificationKey,
		bufferBytes(normalizedSignatureBytes),
		bufferBytes(data),
	);
}

function namedCurveFromKeyAlgorithm(
	algorithm: CryptoKey["algorithm"],
): "P-256" | "P-384" | "P-521" {
	const candidate = algorithm as CryptoKey["algorithm"] & {
		namedCurve?: string;
	};

	if (
		candidate.name !== "ECDSA" ||
		!candidate.namedCurve ||
		!SUPPORTED_NAMED_CURVES.includes(
			candidate.namedCurve as (typeof SUPPORTED_NAMED_CURVES)[number],
		)
	) {
		throw new Error("cms_signature_curve_invalid");
	}

	return candidate.namedCurve as "P-256" | "P-384" | "P-521";
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
	const verificationKey = await importSignerVerificationKey({
		hashAlgorithm,
		signatureAlgorithm: signerInfo.signatureAlgorithm,
		signerCert,
	});
	const verificationParams = signatureVerificationParams({
		hashAlgorithm,
		signatureAlgorithm: signerInfo.signatureAlgorithm,
		signerCert,
	});
	const namedCurve =
		verificationKey.algorithm.name === "ECDSA"
			? namedCurveFromKeyAlgorithm(verificationKey.algorithm)
			: null;
	const signatureBytes = namedCurve
		? ecdsaSignatureBytes({
				namedCurve,
				signatureBytes: rawSignatureBytes,
			})
		: rawSignatureBytes;

	return crypto.subtle.verify(
		verificationParams,
		verificationKey,
		bufferBytes(signatureBytes),
		bufferBytes(signedBytes),
	);
}
