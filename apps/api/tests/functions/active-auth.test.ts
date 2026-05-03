import { describe, expect, test } from "bun:test";
import { Integer, ObjectIdentifier, Sequence } from "asn1js";
import { AlgorithmIdentifier, PublicKeyInfo } from "pkijs";
import { ensurePkijsEngine } from "@/v1/verify/pkd-trust";
import { validateActiveAuthentication } from "@/v1/verify/validation";

const ICAO_CHALLENGE_BYTES = 8;
const RSA_ENCRYPTION_OID = "1.2.840.113549.1.1.1";
const ID_AA_OID = "2.23.136.1.1.5";
const ECDSA_PLAIN_SHA256_OID = "0.4.0.127.0.7.1.1.4.1.3";

type SupportedNamedCurve = "P-256" | "P-384" | "P-521";

function bufferBytes(bytes: Uint8Array): ArrayBuffer {
	return bytes.slice().buffer;
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

function base64UrlToBytes(value: string): Uint8Array {
	const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
	const padded = normalized.padEnd(
		normalized.length + ((4 - (normalized.length % 4)) % 4),
		"=",
	);
	return new Uint8Array(Buffer.from(padded, "base64"));
}

function concatenateBytes(...parts: Uint8Array[]): Uint8Array {
	const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
	const combined = new Uint8Array(totalLength);
	let offset = 0;
	for (const part of parts) {
		combined.set(part, offset);
		offset += part.length;
	}
	return combined;
}

function encodeTlv(tag: number, value: Uint8Array): Uint8Array {
	const lengthBytes: number[] = [];

	if (value.length < 0x80) {
		lengthBytes.push(value.length);
	} else {
		let remaining = value.length;
		const accumulator: number[] = [];
		while (remaining > 0) {
			accumulator.unshift(remaining % 0x1_00);
			remaining = Math.floor(remaining / 0x1_00);
		}
		lengthBytes.push(0x80 + accumulator.length, ...accumulator);
	}

	return Uint8Array.from([tag, ...lengthBytes, ...value]);
}

function buildDg15Envelope(subjectPublicKeyInfoBytes: Uint8Array): Uint8Array {
	return encodeTlv(0x6f, subjectPublicKeyInfoBytes);
}

function buildDg14Envelope(activeAuthInfo: Uint8Array): Uint8Array {
	const securityInfos = encodeTlv(0x31, activeAuthInfo);
	return encodeTlv(0x6e, securityInfos);
}

function activeAuthInfoSequence(signatureAlgorithmOid?: string): Uint8Array {
	const value = [
		new ObjectIdentifier({ value: ID_AA_OID }),
		new Integer({ value: 1 }),
	] as unknown[];

	if (signatureAlgorithmOid) {
		value.push(new ObjectIdentifier({ value: signatureAlgorithmOid }));
	}

	const sequence = new Sequence({ value: value as never });
	return new Uint8Array(sequence.toBER(false));
}

async function generateEcdsaKeyPair(
	namedCurve: SupportedNamedCurve,
): Promise<CryptoKeyPair> {
	const generated = await crypto.subtle.generateKey(
		{
			name: "ECDSA",
			namedCurve,
		},
		true,
		["sign", "verify"],
	);

	if (!("publicKey" in generated && "privateKey" in generated)) {
		throw new Error("ec_keypair_generation_failed");
	}

	return generated;
}

async function generateRsaKeyPair(modulusLength: number): Promise<{
	keyPair: CryptoKeyPair;
	exportedPrivateJwk: JsonWebKey;
}> {
	const generated = await crypto.subtle.generateKey(
		{
			name: "RSA-PSS",
			modulusLength,
			publicExponent: Uint8Array.of(0x01, 0x00, 0x01),
			hash: "SHA-256",
		},
		true,
		["sign", "verify"],
	);

	if (!("publicKey" in generated && "privateKey" in generated)) {
		throw new Error("rsa_keypair_generation_failed");
	}

	const exportedPrivateJwk = await crypto.subtle.exportKey(
		"jwk",
		generated.privateKey,
	);

	return {
		exportedPrivateJwk,
		keyPair: generated,
	};
}

async function ecdsaSubjectPublicKeyInfoBytes(
	publicKey: CryptoKey,
): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.exportKey("spki", publicKey));
}

async function manuallyConvertSpkiToRsaIfNeeded(
	spki: Uint8Array,
): Promise<Uint8Array> {
	ensurePkijsEngine();
	const { fromBER, Null } = await import("asn1js");
	const decoded = fromBER(bufferBytes(spki));
	if (decoded.offset === -1) {
		throw new Error("rsa_spki_parse_failed");
	}
	const publicKeyInfo = new PublicKeyInfo({ schema: decoded.result });

	if (publicKeyInfo.algorithm.algorithmId === RSA_ENCRYPTION_OID) {
		return spki;
	}

	publicKeyInfo.algorithm = new AlgorithmIdentifier({
		algorithmId: RSA_ENCRYPTION_OID,
		algorithmParams: new Null(),
	});

	return new Uint8Array(publicKeyInfo.toSchema().toBER(false));
}

async function signEcdsaActiveAuth({
	challenge,
	curveSize,
	hashAlgorithm,
	privateKey,
}: {
	challenge: Uint8Array;
	curveSize: number;
	hashAlgorithm: "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512";
	privateKey: CryptoKey;
}): Promise<Uint8Array> {
	const signatureBuffer = await crypto.subtle.sign(
		{
			hash: hashAlgorithm,
			name: "ECDSA",
		},
		privateKey,
		bufferBytes(challenge),
	);

	const signature = new Uint8Array(signatureBuffer);

	if (signature.length === 2 * curveSize) {
		return signature;
	}

	throw new Error(
		`ecdsa_signature_length_unexpected:${signature.length}:${curveSize}`,
	);
}

async function buildIso9796Ds1Signature({
	challenge,
	hashAlgorithm,
	jwkPrivateKey,
	modulusLength,
}: {
	challenge: Uint8Array;
	hashAlgorithm: "SHA-256";
	jwkPrivateKey: JsonWebKey;
	modulusLength: number;
}): Promise<Uint8Array> {
	const modulusBytes = base64UrlToBytes(jwkPrivateKey.n ?? "");
	const exponentBytes = base64UrlToBytes(jwkPrivateKey.d ?? "");

	if (modulusBytes.length === 0 || exponentBytes.length === 0) {
		throw new Error("rsa_private_key_export_failed");
	}

	const modulusByteLength = Math.ceil(modulusLength / 8);
	const trailerExplicit = Uint8Array.of(0x33, 0xcc);
	const hashLength = 32;
	const m1Length = modulusByteLength - 1 - hashLength - trailerExplicit.length;

	if (m1Length < 0) {
		throw new Error("rsa_modulus_too_small_for_aa");
	}

	const m1 = crypto.getRandomValues(new Uint8Array(m1Length));
	const hashBytes = new Uint8Array(
		await crypto.subtle.digest(
			hashAlgorithm,
			bufferBytes(concatenateBytes(m1, challenge)),
		),
	);

	const recovered = concatenateBytes(
		Uint8Array.of(0x6a),
		m1,
		hashBytes,
		trailerExplicit,
	);

	const modulus = bytesToBigInt(modulusBytes);
	const exponent = bytesToBigInt(exponentBytes);
	const message = bytesToBigInt(recovered);

	if (message >= modulus) {
		throw new Error("rsa_message_exceeds_modulus");
	}

	const signature = modPow(message, exponent, modulus);

	return bigIntToBytes(signature, modulusByteLength);
}

describe("validateActiveAuthentication ECDSA", () => {
	for (const namedCurve of [
		"P-256",
		"P-384",
	] as const satisfies readonly SupportedNamedCurve[]) {
		test(`accepts a valid ECDSA signature on ${namedCurve}`, async () => {
			const keyPair = await generateEcdsaKeyPair(namedCurve);
			const subjectPublicKeyInfoBytes = await ecdsaSubjectPublicKeyInfoBytes(
				keyPair.publicKey,
			);
			const dg15 = buildDg15Envelope(subjectPublicKeyInfoBytes);
			const dg14 = buildDg14Envelope(
				activeAuthInfoSequence(ECDSA_PLAIN_SHA256_OID),
			);
			const challenge = crypto.getRandomValues(
				new Uint8Array(ICAO_CHALLENGE_BYTES),
			);
			const curveSize = namedCurve === "P-256" ? 32 : 48;
			const signature = await signEcdsaActiveAuth({
				challenge,
				curveSize,
				hashAlgorithm: "SHA-256",
				privateKey: keyPair.privateKey,
			});

			const result = await validateActiveAuthentication({
				challenge,
				dg14,
				dg15,
				signature,
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.algorithm).toBe("ecdsa");
				expect(result.hashAlgorithm).toBe("SHA-256");
			}
		});
	}

	test("falls back through ECDSA hash candidates when DG14 omits the algorithm", async () => {
		const keyPair = await generateEcdsaKeyPair("P-256");
		const subjectPublicKeyInfoBytes = await ecdsaSubjectPublicKeyInfoBytes(
			keyPair.publicKey,
		);
		const dg15 = buildDg15Envelope(subjectPublicKeyInfoBytes);
		const challenge = crypto.getRandomValues(
			new Uint8Array(ICAO_CHALLENGE_BYTES),
		);
		const signature = await signEcdsaActiveAuth({
			challenge,
			curveSize: 32,
			hashAlgorithm: "SHA-1",
			privateKey: keyPair.privateKey,
		});

		const result = await validateActiveAuthentication({
			challenge,
			dg15,
			signature,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.algorithm).toBe("ecdsa");
			expect(result.hashAlgorithm).toBe("SHA-1");
		}
	});

	test("rejects a tampered ECDSA signature", async () => {
		const keyPair = await generateEcdsaKeyPair("P-256");
		const subjectPublicKeyInfoBytes = await ecdsaSubjectPublicKeyInfoBytes(
			keyPair.publicKey,
		);
		const dg15 = buildDg15Envelope(subjectPublicKeyInfoBytes);
		const dg14 = buildDg14Envelope(
			activeAuthInfoSequence(ECDSA_PLAIN_SHA256_OID),
		);
		const challenge = crypto.getRandomValues(
			new Uint8Array(ICAO_CHALLENGE_BYTES),
		);
		const signature = await signEcdsaActiveAuth({
			challenge,
			curveSize: 32,
			hashAlgorithm: "SHA-256",
			privateKey: keyPair.privateKey,
		});

		const tamperedSignature = signature.slice();
		tamperedSignature[0] ^= 0x01;

		const result = await validateActiveAuthentication({
			challenge,
			dg14,
			dg15,
			signature: tamperedSignature,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("signature_invalid");
		}
	});

	test("rejects when challenge length is not 8 bytes", async () => {
		const keyPair = await generateEcdsaKeyPair("P-256");
		const subjectPublicKeyInfoBytes = await ecdsaSubjectPublicKeyInfoBytes(
			keyPair.publicKey,
		);
		const dg15 = buildDg15Envelope(subjectPublicKeyInfoBytes);
		const result = await validateActiveAuthentication({
			challenge: new Uint8Array(7),
			dg15,
			signature: new Uint8Array(64),
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("challenge_invalid_length");
		}
	});
});

describe("validateActiveAuthentication RSA (ISO/IEC 9796-2 DS1)", () => {
	test("accepts a valid RSA-AA signature", async () => {
		const modulusLength = 2048;
		const { exportedPrivateJwk, keyPair } =
			await generateRsaKeyPair(modulusLength);
		const exportedSpki = new Uint8Array(
			await crypto.subtle.exportKey("spki", keyPair.publicKey),
		);
		const rsaSpki = await manuallyConvertSpkiToRsaIfNeeded(exportedSpki);
		const dg15 = buildDg15Envelope(rsaSpki);
		const challenge = crypto.getRandomValues(
			new Uint8Array(ICAO_CHALLENGE_BYTES),
		);
		const signature = await buildIso9796Ds1Signature({
			challenge,
			hashAlgorithm: "SHA-256",
			jwkPrivateKey: exportedPrivateJwk,
			modulusLength,
		});

		const result = await validateActiveAuthentication({
			challenge,
			dg15,
			signature,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.algorithm).toBe("rsa");
			expect(result.hashAlgorithm).toBe("SHA-256");
		}
	});

	test("rejects a forged RSA signature", async () => {
		const modulusLength = 2048;
		const { exportedPrivateJwk, keyPair } =
			await generateRsaKeyPair(modulusLength);
		const exportedSpki = new Uint8Array(
			await crypto.subtle.exportKey("spki", keyPair.publicKey),
		);
		const rsaSpki = await manuallyConvertSpkiToRsaIfNeeded(exportedSpki);
		const dg15 = buildDg15Envelope(rsaSpki);
		const challenge = crypto.getRandomValues(
			new Uint8Array(ICAO_CHALLENGE_BYTES),
		);
		const validSignature = await buildIso9796Ds1Signature({
			challenge,
			hashAlgorithm: "SHA-256",
			jwkPrivateKey: exportedPrivateJwk,
			modulusLength,
		});

		const tampered = validSignature.slice();
		tampered[0] ^= 0xff;

		const result = await validateActiveAuthentication({
			challenge,
			dg15,
			signature: tampered,
		});

		expect(result.ok).toBe(false);
	});
});
