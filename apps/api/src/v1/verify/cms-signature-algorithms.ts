import {
	type AlgorithmIdentifier,
	getHashAlgorithm,
	type SignerInfo,
} from "pkijs";
import { bufferBytes, subtleAlgorithmFromOid } from "./sod-asn1-utils";
import type { SupportedHashAlgorithm } from "./validation-types";

export async function createDigest(
	algorithm: SupportedHashAlgorithm,
	data: Uint8Array,
): Promise<Uint8Array> {
	return new Uint8Array(
		await crypto.subtle.digest(algorithm, bufferBytes(data)),
	);
}

export function parseSupportedHashAlgorithmName(
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

export function signerDigestAlgorithm(
	signerInfo: SignerInfo,
): SupportedHashAlgorithm | null {
	return subtleAlgorithmFromOid(signerInfo.digestAlgorithm.algorithmId);
}

export function signatureHashAlgorithm(
	signerInfo: SignerInfo,
): SupportedHashAlgorithm | null {
	const algorithmFromSignature = parseSupportedHashAlgorithmName(
		getHashAlgorithm(signerInfo.signatureAlgorithm) || null,
	);

	return algorithmFromSignature ?? signerDigestAlgorithm(signerInfo);
}

export function algorithmIdentifierHashAlgorithm(
	signatureAlgorithm: AlgorithmIdentifier,
): SupportedHashAlgorithm | null {
	return parseSupportedHashAlgorithmName(
		getHashAlgorithm(signatureAlgorithm) || null,
	);
}
