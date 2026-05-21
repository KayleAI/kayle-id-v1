import {
	type AlgorithmIdentifier,
	type Certificate,
	getHashAlgorithm,
	RSASSAPSSParams,
	type SignerInfo,
} from "pkijs";
import {
	algorithmIdentifierHashAlgorithm,
	parseSupportedHashAlgorithmName,
} from "./cms-signature-algorithms";
import { bufferBytes } from "./sod-asn1-utils";
import {
	ECDSA_PUBLIC_KEY_OID,
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

export async function verifySignatureBytesWithCertificate({
	data,
	hashAlgorithm,
	publicKeyCert,
	signatureAlgorithm,
	signatureBytes,
}: {
	data: Uint8Array;
	hashAlgorithm: SupportedHashAlgorithm;
	publicKeyCert: Certificate;
	signatureAlgorithm: SignerInfo["signatureAlgorithm"];
	signatureBytes: Uint8Array;
}): Promise<boolean> {
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

	return verifySignatureBytesWithCertificate({
		data,
		hashAlgorithm,
		publicKeyCert,
		signatureAlgorithm,
		signatureBytes,
	});
}
