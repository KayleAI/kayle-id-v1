import { Set as Asn1Set, Integer, ObjectIdentifier, Sequence } from "asn1js";
import { exactBytes, parseBer, sequenceChildren } from "./sod-asn1-utils";
import { readTlv } from "./tlv";

const DG14_ROOT_TAG = 0x6e;
const ID_AA_OID = "2.23.136.1.1.5";

export const ECDSA_PLAIN_SHA1_OID = "0.4.0.127.0.7.1.1.4.1.1";
export const ECDSA_PLAIN_SHA224_OID = "0.4.0.127.0.7.1.1.4.1.2";
export const ECDSA_PLAIN_SHA256_OID = "0.4.0.127.0.7.1.1.4.1.3";
export const ECDSA_PLAIN_SHA384_OID = "0.4.0.127.0.7.1.1.4.1.4";
export const ECDSA_PLAIN_SHA512_OID = "0.4.0.127.0.7.1.1.4.1.5";

export type ActiveAuthEcdsaHashAlgorithm =
	| "SHA-1"
	| "SHA-224"
	| "SHA-256"
	| "SHA-384"
	| "SHA-512";

export type ParsedDg14 = {
	activeAuthEcdsaHashAlgorithm: ActiveAuthEcdsaHashAlgorithm | null;
};

function unwrapDg14Body(dg14: Uint8Array): Uint8Array {
	try {
		const root = readTlv(dg14, 0);

		if (root.tag === DG14_ROOT_TAG && root.nextOffset === dg14.length) {
			return root.value;
		}
	} catch {
		return dg14;
	}

	return dg14;
}

function ecdsaPlainHashAlgorithmFromOid(
	oid: string,
): ActiveAuthEcdsaHashAlgorithm | null {
	switch (oid) {
		case ECDSA_PLAIN_SHA1_OID:
			return "SHA-1";
		case ECDSA_PLAIN_SHA224_OID:
			return "SHA-224";
		case ECDSA_PLAIN_SHA256_OID:
			return "SHA-256";
		case ECDSA_PLAIN_SHA384_OID:
			return "SHA-384";
		case ECDSA_PLAIN_SHA512_OID:
			return "SHA-512";
		default:
			return null;
	}
}

function readActiveAuthInfo(
	securityInfo: Sequence,
): ActiveAuthEcdsaHashAlgorithm | null {
	const [oidNode, versionNode, signatureAlgorithmNode] =
		sequenceChildren(securityInfo);

	if (
		!(
			oidNode instanceof ObjectIdentifier &&
			oidNode.valueBlock.toString() === ID_AA_OID &&
			versionNode instanceof Integer
		)
	) {
		return null;
	}

	if (!(signatureAlgorithmNode instanceof ObjectIdentifier)) {
		return null;
	}

	return ecdsaPlainHashAlgorithmFromOid(
		signatureAlgorithmNode.valueBlock.toString(),
	);
}

export function parseDg14(dg14: Uint8Array): ParsedDg14 {
	if (dg14.length === 0) {
		return { activeAuthEcdsaHashAlgorithm: null };
	}

	const securityInfosBytes = exactBytes(unwrapDg14Body(dg14));
	const root = parseBer(securityInfosBytes, "dg14_parse_failed");

	if (!(root instanceof Asn1Set || root instanceof Sequence)) {
		throw new Error("dg14_parse_failed");
	}

	let hashAlgorithm: ActiveAuthEcdsaHashAlgorithm | null = null;

	for (const child of root.valueBlock.value) {
		if (!(child instanceof Sequence)) {
			continue;
		}

		const candidate = readActiveAuthInfo(child);

		if (candidate) {
			hashAlgorithm = candidate;
			break;
		}
	}

	return { activeAuthEcdsaHashAlgorithm: hashAlgorithm };
}
