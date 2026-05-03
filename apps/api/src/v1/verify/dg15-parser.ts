import { Sequence } from "asn1js";
import { PublicKeyInfo } from "pkijs";
import { ensurePkijsEngine } from "./pkd-trust";
import { exactBytes, parseBer } from "./sod-asn1-utils";
import { ECDSA_PUBLIC_KEY_OID, RSA_ENCRYPTION_OID } from "./sod-constants";
import { readTlv } from "./tlv";

const DG15_ROOT_TAG = 0x6f;

export type Dg15PublicKeyType = "rsa" | "ecdsa";

export type ParsedDg15 = {
	publicKeyInfo: PublicKeyInfo;
	publicKeyType: Dg15PublicKeyType;
	subjectPublicKeyInfoBytes: Uint8Array;
};

function unwrapDg15Body(dg15: Uint8Array): Uint8Array {
	try {
		const root = readTlv(dg15, 0);

		if (root.tag === DG15_ROOT_TAG && root.nextOffset === dg15.length) {
			return root.value;
		}
	} catch {
		return dg15;
	}

	return dg15;
}

function publicKeyTypeFromOid(oid: string): Dg15PublicKeyType {
	if (oid === RSA_ENCRYPTION_OID) {
		return "rsa";
	}

	if (oid === ECDSA_PUBLIC_KEY_OID) {
		return "ecdsa";
	}

	throw new Error("dg15_public_key_algorithm_unsupported");
}

export function parseDg15(dg15: Uint8Array): ParsedDg15 {
	if (dg15.length === 0) {
		throw new Error("dg15_missing");
	}

	ensurePkijsEngine();

	const subjectPublicKeyInfoBytes = exactBytes(unwrapDg15Body(dg15));
	const schema = parseBer(subjectPublicKeyInfoBytes, "dg15_parse_failed");

	if (!(schema instanceof Sequence)) {
		throw new Error("dg15_parse_failed");
	}

	let publicKeyInfo: PublicKeyInfo;

	try {
		publicKeyInfo = new PublicKeyInfo({ schema });
	} catch {
		throw new Error("dg15_parse_failed");
	}

	const algorithmId = publicKeyInfo.algorithm.algorithmId;

	if (typeof algorithmId !== "string") {
		throw new Error("dg15_parse_failed");
	}

	const publicKeyType = publicKeyTypeFromOid(algorithmId);

	return {
		publicKeyInfo,
		publicKeyType,
		subjectPublicKeyInfoBytes,
	};
}
