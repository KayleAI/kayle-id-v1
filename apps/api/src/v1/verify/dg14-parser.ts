import { Set as Asn1Set, Integer, ObjectIdentifier, Sequence } from "asn1js";
import {
	type ChipAuthAlgorithm,
	chipAuthAlgorithmFromOid,
} from "./chip-auth-oids";
import {
	type ChipAuthPublicKeyAlgorithm,
	chipAuthPublicKeyAlgorithmFromOid,
} from "./chip-auth-public-key-oids";
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

export type ChipAuthInfoEntry = {
	algorithm: ChipAuthAlgorithm;
	keyId: bigint | null;
	version: number;
};

export type ChipAuthPublicKeyInfoEntry = {
	algorithm: ChipAuthPublicKeyAlgorithm;
	algorithmOid: string;
	keyId: bigint | null;
	subjectPublicKeyInfoBytes: Uint8Array;
};

export type ParsedDg14 = {
	activeAuthEcdsaHashAlgorithm: ActiveAuthEcdsaHashAlgorithm | null;
	chipAuthInfos: ChipAuthInfoEntry[];
	chipAuthPublicKeys: ChipAuthPublicKeyInfoEntry[];
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

function readKeyId(node: unknown): bigint | null {
	if (!(node instanceof Integer)) {
		return null;
	}

	const bytes = new Uint8Array(node.valueBlock.valueHexView);

	if (bytes.length === 0) {
		return 0n;
	}

	let result = 0n;
	for (const byte of bytes) {
		result = (result << 8n) | BigInt(byte);
	}
	return result;
}

function readChipAuthInfo(securityInfo: Sequence): ChipAuthInfoEntry | null {
	const [oidNode, versionNode, keyIdNode] = sequenceChildren(securityInfo);

	if (
		!(oidNode instanceof ObjectIdentifier && versionNode instanceof Integer)
	) {
		return null;
	}

	const algorithm = chipAuthAlgorithmFromOid(oidNode.valueBlock.toString());

	if (!algorithm) {
		return null;
	}

	const versionBytes = new Uint8Array(versionNode.valueBlock.valueHexView);
	let version = 0;
	for (const byte of versionBytes) {
		version = (version << 8) | byte;
	}

	return {
		algorithm,
		keyId: readKeyId(keyIdNode),
		version,
	};
}

function readChipAuthPublicKeyInfo(
	securityInfo: Sequence,
): ChipAuthPublicKeyInfoEntry | null {
	const [oidNode, subjectPublicKeyInfoNode, keyIdNode] =
		sequenceChildren(securityInfo);

	if (
		!(
			oidNode instanceof ObjectIdentifier &&
			subjectPublicKeyInfoNode instanceof Sequence
		)
	) {
		return null;
	}

	const algorithmOid = oidNode.valueBlock.toString();
	const algorithm = chipAuthPublicKeyAlgorithmFromOid(algorithmOid);

	if (!algorithm) {
		return null;
	}

	const subjectPublicKeyInfoBytes = exactBytes(
		new Uint8Array(subjectPublicKeyInfoNode.toBER(false)),
	);

	return {
		algorithm,
		algorithmOid,
		keyId: readKeyId(keyIdNode),
		subjectPublicKeyInfoBytes,
	};
}

export function parseDg14(dg14: Uint8Array): ParsedDg14 {
	if (dg14.length === 0) {
		return {
			activeAuthEcdsaHashAlgorithm: null,
			chipAuthInfos: [],
			chipAuthPublicKeys: [],
		};
	}

	const securityInfosBytes = exactBytes(unwrapDg14Body(dg14));
	const root = parseBer(securityInfosBytes, "dg14_parse_failed");

	if (!(root instanceof Asn1Set || root instanceof Sequence)) {
		throw new Error("dg14_parse_failed");
	}

	let activeAuthEcdsaHashAlgorithm: ActiveAuthEcdsaHashAlgorithm | null = null;
	const chipAuthInfos: ChipAuthInfoEntry[] = [];
	const chipAuthPublicKeys: ChipAuthPublicKeyInfoEntry[] = [];

	for (const child of root.valueBlock.value) {
		if (!(child instanceof Sequence)) {
			continue;
		}

		const aaCandidate = readActiveAuthInfo(child);
		if (aaCandidate && !activeAuthEcdsaHashAlgorithm) {
			activeAuthEcdsaHashAlgorithm = aaCandidate;
			continue;
		}

		const caInfo = readChipAuthInfo(child);
		if (caInfo) {
			chipAuthInfos.push(caInfo);
			continue;
		}

		const caPublicKeyInfo = readChipAuthPublicKeyInfo(child);
		if (caPublicKeyInfo) {
			chipAuthPublicKeys.push(caPublicKeyInfo);
		}
	}

	return {
		activeAuthEcdsaHashAlgorithm,
		chipAuthInfos,
		chipAuthPublicKeys,
	};
}
