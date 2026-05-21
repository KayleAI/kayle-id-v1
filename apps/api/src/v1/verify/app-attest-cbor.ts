export type CborValue =
	| number
	| string
	| Uint8Array
	| CborValue[]
	| Map<CborValue, CborValue>;

export type AttestationCbor = {
	fmt: string;
	attStmt: { x5c: Uint8Array[]; receipt: Uint8Array };
	authData: Uint8Array;
};

export type AssertionCbor = {
	signature: Uint8Array;
	authenticatorData: Uint8Array;
};

export function decodeAttestationCbor(bytes: Uint8Array): AttestationCbor {
	const { value } = decodeCbor(bytes, 0);
	if (!(value instanceof Map)) {
		throw new Error("attestation_root_not_map");
	}

	const fmt = mapGet(value, "fmt");
	const attStmtRaw = mapGet(value, "attStmt");
	const authData = mapGet(value, "authData");

	if (typeof fmt !== "string") throw new Error("fmt_not_text");
	if (!(attStmtRaw instanceof Map)) throw new Error("attStmt_not_map");
	if (!(authData instanceof Uint8Array)) {
		throw new Error("authData_not_bytes");
	}

	const x5c = mapGet(attStmtRaw, "x5c");
	const receipt = mapGet(attStmtRaw, "receipt");

	if (!Array.isArray(x5c)) throw new Error("x5c_not_array");
	const x5cBytes: Uint8Array[] = [];
	for (const item of x5c) {
		if (!(item instanceof Uint8Array)) throw new Error("x5c_entry_not_bytes");
		x5cBytes.push(item);
	}

	if (!(receipt instanceof Uint8Array)) {
		throw new Error("receipt_not_bytes");
	}

	return { fmt, attStmt: { x5c: x5cBytes, receipt }, authData };
}

export function decodeAssertionCbor(bytes: Uint8Array): AssertionCbor {
	const { value } = decodeCbor(bytes, 0);
	if (!(value instanceof Map)) {
		throw new Error("assertion_root_not_map");
	}
	const signature = mapGet(value, "signature");
	const authenticatorData = mapGet(value, "authenticatorData");

	if (!(signature instanceof Uint8Array)) {
		throw new Error("signature_not_bytes");
	}
	if (!(authenticatorData instanceof Uint8Array)) {
		throw new Error("authenticatorData_not_bytes");
	}

	return { signature, authenticatorData };
}

export function decodeCbor(
	bytes: Uint8Array,
	offset: number,
): { value: CborValue; next: number } {
	if (offset >= bytes.length) throw new Error("cbor_truncated");
	const initial = bytes[offset] as number;
	const major = initial >> 5;
	const additional = initial & 0x1f;
	const after = offset + 1;

	const { length, next: lenNext } = readArgument(bytes, after, additional);

	switch (major) {
		case 0:
			return { value: length, next: lenNext };
		case 1:
			return { value: -1 - length, next: lenNext };
		case 2: {
			const end = lenNext + length;
			if (end > bytes.length) throw new Error("cbor_byte_string_truncated");
			return { value: bytes.slice(lenNext, end), next: end };
		}
		case 3: {
			const end = lenNext + length;
			if (end > bytes.length) throw new Error("cbor_text_string_truncated");
			return {
				value: new TextDecoder("utf-8", {
					fatal: true,
					ignoreBOM: false,
				}).decode(bytes.slice(lenNext, end)),
				next: end,
			};
		}
		case 4: {
			const items: CborValue[] = [];
			let cursor = lenNext;
			for (let i = 0; i < length; i += 1) {
				const decoded = decodeCbor(bytes, cursor);
				items.push(decoded.value);
				cursor = decoded.next;
			}
			return { value: items, next: cursor };
		}
		case 5: {
			const map = new Map<CborValue, CborValue>();
			let cursor = lenNext;
			for (let i = 0; i < length; i += 1) {
				const keyDecoded = decodeCbor(bytes, cursor);
				const valDecoded = decodeCbor(bytes, keyDecoded.next);
				map.set(keyDecoded.value, valDecoded.value);
				cursor = valDecoded.next;
			}
			return { value: map, next: cursor };
		}
		default:
			throw new Error(`cbor_unsupported_major_${major}`);
	}
}

function mapGet(map: Map<CborValue, CborValue>, key: string): CborValue {
	for (const [k, v] of map) {
		if (k === key) return v;
	}
	throw new Error(`cbor_map_missing_key:${key}`);
}

function readArgument(
	bytes: Uint8Array,
	offset: number,
	additional: number,
): { length: number; next: number } {
	if (additional < 24) {
		return { length: additional, next: offset };
	}
	if (additional === 24) {
		if (offset >= bytes.length) throw new Error("cbor_truncated_arg_1");
		return { length: bytes[offset] as number, next: offset + 1 };
	}
	if (additional === 25) {
		if (offset + 1 >= bytes.length) throw new Error("cbor_truncated_arg_2");
		return {
			length: ((bytes[offset] as number) << 8) | (bytes[offset + 1] as number),
			next: offset + 2,
		};
	}
	if (additional === 26) {
		if (offset + 3 >= bytes.length) throw new Error("cbor_truncated_arg_4");
		const high =
			((bytes[offset] as number) << 8) | (bytes[offset + 1] as number);
		const low =
			((bytes[offset + 2] as number) << 8) | (bytes[offset + 3] as number);
		return {
			length: high * 0x10000 + low,
			next: offset + 4,
		};
	}
	throw new Error(`cbor_unsupported_argument_${additional}`);
}
