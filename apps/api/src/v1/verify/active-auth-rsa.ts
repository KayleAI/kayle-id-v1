import { Integer, Sequence } from "asn1js";
import {
	type AaHashAlgorithm,
	digestBytes,
	HASH_LENGTHS,
} from "./active-auth-hash";
import { concatenateBytes, failureResult } from "./active-auth-result";
import type { ParsedDg15 } from "./dg15-parser";
import { bytesEqual, exactBytes, parseBer } from "./sod-asn1-utils";
import type { ActiveAuthValidationResult } from "./validation-types";

const ISO_9796_2_LEADING_BYTE = 0x6a;
const ISO_9796_2_IMPLICIT_TRAILER = 0xbc;
const ISO_9796_2_EXPLICIT_TRAILER = 0xcc;

const ISO_9796_2_EXPLICIT_HASH_BY_ID: Record<number, AaHashAlgorithm> = {
	51: "SHA-256",
	52: "SHA-384",
	53: "SHA-512",
	56: "SHA-224",
};

function bytesToBigInt(bytes: Uint8Array): bigint {
	let result = 0n;
	for (const byte of bytes) {
		result = (result << 8n) | BigInt(byte);
	}
	return result;
}

function bigIntToBytes(value: bigint, length: number): Uint8Array {
	const bytes = new Uint8Array(length);
	let remaining = value;
	for (let index = length - 1; index >= 0; index -= 1) {
		bytes[index] = Number(remaining & 0xffn);
		remaining >>= 8n;
	}
	return bytes;
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
	let result = 1n;
	let normalized = base % modulus;
	let exp = exponent;

	while (exp > 0n) {
		if (exp & 1n) {
			result = (result * normalized) % modulus;
		}
		exp >>= 1n;
		normalized = (normalized * normalized) % modulus;
	}

	return result;
}

function trimLeadingZero(bytes: Uint8Array): Uint8Array {
	let offset = 0;
	while (offset < bytes.length - 1 && bytes[offset] === 0) {
		offset += 1;
	}
	return bytes.subarray(offset);
}

function rsaPublicKeyComponents(parsedDg15: ParsedDg15): {
	exponent: bigint;
	modulus: bigint;
	modulusBytes: number;
} {
	const subjectPublicKeyBytes = exactBytes(
		new Uint8Array(
			parsedDg15.publicKeyInfo.subjectPublicKey.valueBlock.valueHexView,
		),
	);
	const decoded = parseBer(subjectPublicKeyBytes, "dg15_rsa_key_invalid");

	if (!(decoded instanceof Sequence)) {
		throw new Error("dg15_rsa_key_invalid");
	}

	const [modulusNode, exponentNode] = decoded.valueBlock.value;

	if (!(modulusNode instanceof Integer && exponentNode instanceof Integer)) {
		throw new Error("dg15_rsa_key_invalid");
	}

	const modulusBytes = exactBytes(
		new Uint8Array(modulusNode.valueBlock.valueHexView),
	);
	const trimmedModulusBytes = trimLeadingZero(modulusBytes);
	const exponentBytes = exactBytes(
		new Uint8Array(exponentNode.valueBlock.valueHexView),
	);

	return {
		exponent: bytesToBigInt(trimLeadingZero(exponentBytes)),
		modulus: bytesToBigInt(trimmedModulusBytes),
		modulusBytes: trimmedModulusBytes.length,
	};
}

function recoveryStructure(
	recovered: Uint8Array,
): { hash: AaHashAlgorithm; m1: Uint8Array; signedHash: Uint8Array } | null {
	if (recovered.length === 0 || recovered[0] !== ISO_9796_2_LEADING_BYTE) {
		return null;
	}

	const trailer = recovered[recovered.length - 1];

	if (trailer === ISO_9796_2_IMPLICIT_TRAILER) {
		const hashLength = HASH_LENGTHS["SHA-1"];
		const hashStart = recovered.length - 1 - hashLength;

		if (hashStart < 1) {
			return null;
		}

		return {
			hash: "SHA-1",
			m1: recovered.slice(1, hashStart),
			signedHash: recovered.slice(hashStart, recovered.length - 1),
		};
	}

	if (trailer !== ISO_9796_2_EXPLICIT_TRAILER || recovered.length < 3) {
		return null;
	}

	const explicitId = recovered[recovered.length - 2];
	const explicitHash = ISO_9796_2_EXPLICIT_HASH_BY_ID[explicitId];

	if (!explicitHash) {
		return null;
	}

	const hashLength = HASH_LENGTHS[explicitHash];
	const hashStart = recovered.length - 2 - hashLength;

	if (hashStart < 1) {
		return null;
	}

	return {
		hash: explicitHash,
		m1: recovered.slice(1, hashStart),
		signedHash: recovered.slice(hashStart, recovered.length - 2),
	};
}

export async function verifyRsaActiveAuthentication({
	challenge,
	parsedDg15,
	signature,
}: {
	challenge: Uint8Array;
	parsedDg15: ParsedDg15;
	signature: Uint8Array;
}): Promise<ActiveAuthValidationResult> {
	let components: ReturnType<typeof rsaPublicKeyComponents>;

	try {
		components = rsaPublicKeyComponents(parsedDg15);
	} catch {
		return failureResult("public_key_invalid");
	}

	if (signature.length !== components.modulusBytes) {
		return failureResult("signature_invalid_encoding");
	}

	const recovered = bigIntToBytes(
		modPow(bytesToBigInt(signature), components.exponent, components.modulus),
		components.modulusBytes,
	);

	const decoded = recoveryStructure(recovered);

	if (!decoded) {
		return failureResult("signature_format_invalid");
	}

	const expectedHash = await digestBytes(
		decoded.hash,
		concatenateBytes(decoded.m1, challenge),
	);

	if (!bytesEqual(expectedHash, decoded.signedHash)) {
		return failureResult("signature_invalid");
	}

	return {
		algorithm: "rsa",
		hashAlgorithm: decoded.hash,
		ok: true,
	};
}
