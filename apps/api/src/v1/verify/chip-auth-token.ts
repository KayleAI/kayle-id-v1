import { ObjectIdentifier } from "asn1js";
import { concatUint8Arrays } from "./sod-asn1-utils";

const TR_03110_PUBLIC_KEY_TOKEN_TAG = Uint8Array.of(0x7f, 0x49);

export const CHIP_AUTH_DH_VALUE_TAG = 0x84;
export const ECDH_POINT_TAG = 0x86;

function encodeBerLength(length: number): Uint8Array {
	if (length < 0x80) {
		return Uint8Array.of(length);
	}

	const bytes: number[] = [];
	let remaining = length;
	while (remaining > 0) {
		bytes.unshift(remaining & 0xff);
		remaining = Math.floor(remaining / 0x100);
	}
	return Uint8Array.from([0x80 | bytes.length, ...bytes]);
}

function derEncodedOid(oid: string): Uint8Array {
	return new Uint8Array(new ObjectIdentifier({ value: oid }).toBER(false));
}

export function encodeAuthenticatedPublicKey({
	algorithmOid,
	innerTag,
	innerValue,
}: {
	algorithmOid: string;
	innerTag: number;
	innerValue: Uint8Array;
}): Uint8Array {
	const oidTlv = derEncodedOid(algorithmOid);
	const innerTlv = concatUint8Arrays([
		Uint8Array.of(innerTag),
		encodeBerLength(innerValue.length),
		innerValue,
	]);
	const body = concatUint8Arrays([oidTlv, innerTlv]);
	return concatUint8Arrays([
		TR_03110_PUBLIC_KEY_TOKEN_TAG,
		encodeBerLength(body.length),
		body,
	]);
}
