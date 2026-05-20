import { Integer, Sequence } from "asn1js";
import { type ActiveAuthEcdsaHashAlgorithm, parseDg14 } from "./dg14-parser";
import { type ParsedDg15, parseDg15 } from "./dg15-parser";
import { ensurePkijsEngine } from "./pkd-trust";
import {
	bufferBytes,
	bytesEqual,
	exactBytes,
	parseBer,
} from "./sod-asn1-utils";
import type {
	ActiveAuthFailureReason,
	ActiveAuthValidationResult,
	SupportedHashAlgorithm,
} from "./validation-types";

const ICAO_CHALLENGE_BYTES = 8;
const ACTIVE_AUTH_CHALLENGE_LABEL = "aa:";
const ISO_9796_2_LEADING_BYTE = 0x6a;
const ISO_9796_2_IMPLICIT_TRAILER = 0xbc;
const ISO_9796_2_EXPLICIT_TRAILER = 0xcc;

const HASH_LENGTHS = {
	"SHA-1": 20,
	"SHA-224": 28,
	"SHA-256": 32,
	"SHA-384": 48,
	"SHA-512": 64,
} as const;

type AaHashAlgorithm = keyof typeof HASH_LENGTHS;

const ECDSA_HASH_FALLBACKS: AaHashAlgorithm[] = [
	"SHA-256",
	"SHA-1",
	"SHA-512",
	"SHA-384",
	"SHA-224",
];

const ISO_9796_2_EXPLICIT_HASH_BY_ID: Record<number, AaHashAlgorithm> = {
	51: "SHA-256",
	52: "SHA-384",
	53: "SHA-512",
	56: "SHA-224",
};

/**
 * Derive the 8-byte AA challenge from a server-only secret. Deterministic so
 * it survives WebSocket reconnects within the same attempt without requiring
 * shared state, but unpredictable to anyone without the secret — which is
 * what gives Active Authentication its anti-cloning value.
 */
export async function deriveActiveAuthChallenge({
	sessionId,
	authSecret,
}: {
	sessionId: string;
	authSecret: string;
}): Promise<Uint8Array> {
	const secretBytes = new TextEncoder().encode(authSecret);
	const payloadBytes = new TextEncoder().encode(
		`${ACTIVE_AUTH_CHALLENGE_LABEL}${sessionId}`,
	);
	const key = await crypto.subtle.importKey(
		"raw",
		bufferBytes(secretBytes),
		{
			hash: "SHA-256",
			name: "HMAC",
		},
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		bufferBytes(payloadBytes),
	);

	return new Uint8Array(signature).slice(0, ICAO_CHALLENGE_BYTES);
}

function failureResult(
	reason: ActiveAuthFailureReason,
	detail: string | null = null,
): ActiveAuthValidationResult {
	return {
		detail,
		ok: false,
		reason,
	};
}

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

function trimLeadingZero(bytes: Uint8Array): Uint8Array {
	let offset = 0;
	while (offset < bytes.length - 1 && bytes[offset] === 0) {
		offset += 1;
	}
	return bytes.subarray(offset);
}

function digestBytes(
	algorithm: AaHashAlgorithm,
	data: Uint8Array,
): Promise<Uint8Array> {
	return crypto.subtle
		.digest(algorithm, bufferBytes(data))
		.then((buffer) => new Uint8Array(buffer));
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

async function verifyRsaActiveAuthentication({
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

function concatenateBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
	const combined = new Uint8Array(left.length + right.length);
	combined.set(left, 0);
	combined.set(right, left.length);
	return combined;
}

function ecdsaCurveSize(parsedDg15: ParsedDg15): number {
	const components = parsedDg15.publicKeyInfo.subjectPublicKey.valueBlock
		.valueHexView as Uint8Array;
	const trimmed = exactBytes(components);

	if (trimmed.length === 0 || trimmed[0] !== 0x04) {
		throw new Error("dg15_ec_uncompressed_point_required");
	}

	const coordinateLength = (trimmed.length - 1) / 2;

	if (!Number.isInteger(coordinateLength)) {
		throw new Error("dg15_ec_point_invalid");
	}

	return coordinateLength;
}

function importEcdsaPublicKey(parsedDg15: ParsedDg15): Promise<CryptoKey> {
	const namedCurve = ecNamedCurveFromCoordinateBytes(
		ecdsaCurveSize(parsedDg15),
	);

	return crypto.subtle.importKey(
		"spki",
		bufferBytes(parsedDg15.subjectPublicKeyInfoBytes),
		{
			name: "ECDSA",
			namedCurve,
		},
		true,
		["verify"],
	);
}

function ecNamedCurveFromCoordinateBytes(coordinateBytes: number): string {
	switch (coordinateBytes) {
		case 32:
			return "P-256";
		case 48:
			return "P-384";
		case 66:
			return "P-521";
		default:
			throw new Error("dg15_ec_curve_unsupported");
	}
}

async function verifyEcdsaActiveAuthenticationWithHash({
	challenge,
	hashAlgorithm,
	parsedDg15,
	publicKey,
	signature,
}: {
	challenge: Uint8Array;
	hashAlgorithm: AaHashAlgorithm;
	parsedDg15: ParsedDg15;
	publicKey: CryptoKey;
	signature: Uint8Array;
}): Promise<boolean> {
	const expectedSignatureLength = 2 * ecdsaCurveSize(parsedDg15);

	if (signature.length !== expectedSignatureLength) {
		return false;
	}

	return crypto.subtle.verify(
		{
			hash: hashAlgorithm,
			name: "ECDSA",
		},
		publicKey,
		bufferBytes(signature),
		bufferBytes(challenge),
	);
}

function ecdsaHashCandidates(
	dg14Hash: ActiveAuthEcdsaHashAlgorithm | null,
): AaHashAlgorithm[] {
	if (dg14Hash) {
		return [dg14Hash];
	}

	return ECDSA_HASH_FALLBACKS;
}

async function verifyEcdsaActiveAuthentication({
	challenge,
	dg14Hash,
	parsedDg15,
	signature,
}: {
	challenge: Uint8Array;
	dg14Hash: ActiveAuthEcdsaHashAlgorithm | null;
	parsedDg15: ParsedDg15;
	signature: Uint8Array;
}): Promise<ActiveAuthValidationResult> {
	let publicKey: CryptoKey;

	try {
		publicKey = await importEcdsaPublicKey(parsedDg15);
	} catch {
		return failureResult("public_key_invalid");
	}

	for (const hashAlgorithm of ecdsaHashCandidates(dg14Hash)) {
		const verified = await verifyEcdsaActiveAuthenticationWithHash({
			challenge,
			hashAlgorithm,
			parsedDg15,
			publicKey,
			signature,
		});

		if (verified) {
			return {
				algorithm: "ecdsa",
				hashAlgorithm,
				ok: true,
			};
		}
	}

	return failureResult("signature_invalid");
}

export async function validateActiveAuthentication({
	challenge,
	dg14,
	dg15,
	expectedChallenge,
	signature,
	sodAlgorithm,
	sodDg15Hash,
}: {
	challenge: Uint8Array;
	dg14?: Uint8Array;
	dg15: Uint8Array;
	/**
	 * Server-derived AA challenge. When provided, the chip-side challenge
	 * uploaded by the client must match it exactly — this defeats the
	 * Challenge Semantics weakness from ICAO 9303 Part 11 §6.1.
	 */
	expectedChallenge?: Uint8Array;
	signature: Uint8Array;
	sodAlgorithm?: SupportedHashAlgorithm;
	sodDg15Hash?: Uint8Array;
}): Promise<ActiveAuthValidationResult> {
	if (challenge.length !== ICAO_CHALLENGE_BYTES) {
		return failureResult("challenge_invalid_length");
	}

	if (expectedChallenge && !bytesEqual(challenge, expectedChallenge)) {
		return failureResult("challenge_mismatch");
	}

	if (signature.length === 0) {
		return failureResult("signature_missing");
	}

	if (dg15.length === 0) {
		return failureResult("dg15_missing");
	}

	if (sodAlgorithm && sodDg15Hash) {
		const dg15Digest = await crypto.subtle
			.digest(sodAlgorithm, bufferBytes(dg15))
			.then((buffer) => new Uint8Array(buffer));

		if (!bytesEqual(dg15Digest, sodDg15Hash)) {
			return failureResult("sod_dg15_hash_mismatch");
		}
	}

	ensurePkijsEngine();

	let parsedDg15: ParsedDg15;

	try {
		parsedDg15 = parseDg15(dg15);
	} catch (error) {
		return failureResult(
			"dg15_parse_failed",
			error instanceof Error ? error.message : null,
		);
	}

	let dg14Hash: ActiveAuthEcdsaHashAlgorithm | null = null;

	if (dg14 && dg14.length > 0) {
		try {
			dg14Hash = parseDg14(dg14).activeAuthEcdsaHashAlgorithm;
		} catch (error) {
			return failureResult(
				"dg14_parse_failed",
				error instanceof Error ? error.message : null,
			);
		}
	}

	if (parsedDg15.publicKeyType === "rsa") {
		return verifyRsaActiveAuthentication({
			challenge,
			parsedDg15,
			signature,
		});
	}

	return verifyEcdsaActiveAuthentication({
		challenge,
		dg14Hash,
		parsedDg15,
		signature,
	});
}
