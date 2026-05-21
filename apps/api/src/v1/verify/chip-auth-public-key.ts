import { ObjectIdentifier } from "asn1js";
import { PublicKeyInfo } from "pkijs";
import { exactBytes, parseBer } from "./sod-asn1-utils";
import { ECDSA_PUBLIC_KEY_OID } from "./sod-constants";

export const UNCOMPRESSED_POINT_PREFIX = 0x04;

const NAMED_CURVE_BY_OID: Record<string, { name: string; coordBytes: number }> =
	{
		"1.2.840.10045.3.1.7": { coordBytes: 32, name: "P-256" },
		"1.3.132.0.34": { coordBytes: 48, name: "P-384" },
		"1.3.132.0.35": { coordBytes: 66, name: "P-521" },
	};

export function parseChipPublicKeyInfo(bytes: Uint8Array): {
	publicKeyInfo: PublicKeyInfo;
	namedCurveOid: string | null;
} {
	const schema = parseBer(bytes, "chip_auth_public_key_parse_failed");
	const publicKeyInfo = new PublicKeyInfo({ schema: schema as never });
	const algorithmId = publicKeyInfo.algorithm.algorithmId;
	if (typeof algorithmId !== "string") {
		throw new Error("chip_auth_public_key_parse_failed");
	}

	let namedCurveOid: string | null = null;

	if (
		algorithmId === ECDSA_PUBLIC_KEY_OID &&
		publicKeyInfo.algorithm.algorithmParams instanceof ObjectIdentifier
	) {
		namedCurveOid =
			publicKeyInfo.algorithm.algorithmParams.valueBlock.toString();
	}

	return { namedCurveOid, publicKeyInfo };
}

export function namedCurveFromOid(
	oid: string | null,
): { name: string; coordBytes: number } | null {
	return oid ? (NAMED_CURVE_BY_OID[oid] ?? null) : null;
}

export function chipUncompressedPoint(
	publicKeyInfo: PublicKeyInfo,
): Uint8Array | null {
	const bytes = exactBytes(
		new Uint8Array(publicKeyInfo.subjectPublicKey.valueBlock.valueHexView),
	);

	if (bytes.length === 0 || bytes[0] !== UNCOMPRESSED_POINT_PREFIX) {
		return null;
	}

	return bytes;
}
