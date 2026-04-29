import {
	fromBER,
	Integer,
	ObjectIdentifier,
	OctetString,
	Sequence,
} from "asn1js";
import { hexBytes } from "./pkd-trust-utils";
import {
	OID_PATTERN,
	SHA_1_OID,
	SHA_256_OID,
	SHA_384_OID,
	SHA_512_OID,
} from "./sod-constants";
import type { SupportedHashAlgorithm } from "./validation-types";

export function exactBytes(bytes: Uint8Array): Uint8Array {
	return new Uint8Array(bytes);
}

export function bufferBytes(bytes: Uint8Array): ArrayBuffer {
	return bytes.slice().buffer;
}

export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
	if (left.length !== right.length) {
		return false;
	}

	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) {
			return false;
		}
	}

	return true;
}

export function concatUint8Arrays(parts: Uint8Array[]): Uint8Array {
	const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
	const combined = new Uint8Array(totalLength);
	let offset = 0;

	for (const part of parts) {
		combined.set(part, offset);
		offset += part.length;
	}

	return combined;
}

export function asn1Buffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.slice().buffer;
}

export function subtleAlgorithmFromOid(
	oid: string,
): SupportedHashAlgorithm | null {
	switch (oid) {
		case SHA_1_OID:
			return "SHA-1";
		case SHA_256_OID:
			return "SHA-256";
		case SHA_384_OID:
			return "SHA-384";
		case SHA_512_OID:
			return "SHA-512";
		default:
			return null;
	}
}

export function octetStringBytes(value: OctetString): Uint8Array {
	if (!value.idBlock.isConstructed) {
		return exactBytes(value.valueBlock.valueHexView);
	}

	const parts = value.valueBlock.value.map((child) => {
		if (!(child instanceof OctetString)) {
			throw new Error("invalid_octet_string_child");
		}

		return octetStringBytes(child);
	});

	return concatUint8Arrays(parts);
}

export function parseBer(bytes: Uint8Array, errorCode: string): unknown {
	const decoded = fromBER(asn1Buffer(bytes));

	if (decoded.offset === -1) {
		throw new Error(errorCode);
	}

	return decoded.result;
}

export function oidString(value: string): string | null {
	return OID_PATTERN.test(value) ? value : null;
}

export function integerHexValue(node: unknown): string | null {
	if (!(node instanceof Integer)) {
		return null;
	}

	const bytes = exactBytes(new Uint8Array(node.valueBlock.valueHexView));
	let offset = 0;

	while (offset < bytes.length - 1 && bytes[offset] === 0) {
		offset += 1;
	}

	return hexBytes(bytes.subarray(offset));
}

export function octetStringHexValue(node: unknown): string | null {
	if (!(node instanceof OctetString)) {
		return null;
	}

	return hexBytes(exactBytes(new Uint8Array(node.valueBlock.valueHexView)));
}

export function sequenceChildren(node: unknown): unknown[] {
	return node instanceof Sequence ? node.valueBlock.value : [];
}

export function directObjectIdentifierValue(node: unknown): string | null {
	return node instanceof ObjectIdentifier
		? oidString(node.valueBlock.toString())
		: null;
}
