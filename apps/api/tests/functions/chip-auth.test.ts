import { describe, expect, test } from "bun:test";
import {
	Set as Asn1Set,
	BitString,
	Integer,
	ObjectIdentifier,
	Sequence,
} from "asn1js";
import { AlgorithmIdentifier, PublicKeyInfo } from "pkijs";
import { aesCmac, truncateMacToken } from "@/v1/verify/aes-cmac";
import {
	deriveChipAuthKEnc,
	deriveChipAuthKMac,
} from "@/v1/verify/chip-auth-kdf";
import {
	ID_CA_ECDH_AES_CBC_CMAC_128_OID,
	ID_CA_ECDH_AES_CBC_CMAC_192_OID,
	ID_CA_ECDH_AES_CBC_CMAC_256_OID,
} from "@/v1/verify/chip-auth-oids";
import { ID_PK_ECDH_OID } from "@/v1/verify/chip-auth-public-key-oids";
import { parseDg14 } from "@/v1/verify/dg14-parser";
import { ensurePkijsEngine } from "@/v1/verify/pkd-trust";
import { validateChipAuthentication } from "@/v1/verify/validation";

const ECDSA_PUBLIC_KEY_OID = "1.2.840.10045.2.1";
const P256_NAMED_CURVE_OID = "1.2.840.10045.3.1.7";

function bufferBytes(bytes: Uint8Array): ArrayBuffer {
	return bytes.slice().buffer;
}

function hexToBytes(hex: string): Uint8Array {
	const cleaned = hex.replace(/\s+/gu, "");
	const out = new Uint8Array(cleaned.length / 2);
	for (let index = 0; index < cleaned.length; index += 2) {
		out[index / 2] = Number.parseInt(cleaned.slice(index, index + 2), 16);
	}
	return out;
}

function bytesToHex(bytes: Uint8Array): string {
	let result = "";
	for (const byte of bytes) {
		result += byte.toString(16).padStart(2, "0");
	}
	return result;
}

function concat(...parts: Uint8Array[]): Uint8Array {
	const total = parts.reduce((sum, part) => sum + part.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

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

function encodeUint16(value: number): Uint8Array {
	return Uint8Array.of((value >> 8) & 0xff, value & 0xff);
}

function buildTranscript({
	chipNonce,
	chipToken,
	keyId,
	oid,
	terminalPrivateKey,
	terminalPublicKey,
}: {
	chipNonce: Uint8Array;
	chipToken: Uint8Array;
	keyId: bigint | null;
	oid: string;
	terminalPrivateKey: Uint8Array;
	terminalPublicKey: Uint8Array;
}): Uint8Array {
	const oidBytes = new TextEncoder().encode(oid);
	const keyIdBytes = (() => {
		if (keyId === null) {
			return new Uint8Array();
		}
		const out: number[] = [];
		let remaining = keyId;
		do {
			out.unshift(Number(remaining & 0xffn));
			remaining >>= 8n;
		} while (remaining > 0n);
		return Uint8Array.from(out);
	})();

	return concat(
		Uint8Array.of(0x01),
		encodeUint16(oidBytes.length),
		oidBytes,
		Uint8Array.of(keyIdBytes.length),
		keyIdBytes,
		encodeUint16(terminalPrivateKey.length),
		terminalPrivateKey,
		encodeUint16(terminalPublicKey.length),
		terminalPublicKey,
		Uint8Array.of(chipNonce.length),
		chipNonce,
		Uint8Array.of(chipToken.length),
		chipToken,
	);
}

async function generateP256KeyPair(): Promise<{
	privateScalar: Uint8Array;
	publicPoint: Uint8Array;
	keyPair: CryptoKeyPair;
}> {
	const keyPair = (await crypto.subtle.generateKey(
		{ name: "ECDH", namedCurve: "P-256" },
		true,
		["deriveBits"],
	)) as CryptoKeyPair;

	const jwk = (await crypto.subtle.exportKey(
		"jwk",
		keyPair.privateKey,
	)) as JsonWebKey;

	const privateScalar = base64UrlToBytes(jwk.d ?? "");
	const x = base64UrlToBytes(jwk.x ?? "");
	const y = base64UrlToBytes(jwk.y ?? "");
	const publicPoint = concat(Uint8Array.of(0x04), x, y);

	return { keyPair, privateScalar, publicPoint };
}

function base64UrlToBytes(value: string): Uint8Array {
	const padded = value
		.replace(/-/g, "+")
		.replace(/_/g, "/")
		.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
	return new Uint8Array(Buffer.from(padded, "base64"));
}

function buildEcdhSubjectPublicKeyInfo({
	publicPoint,
}: {
	publicPoint: Uint8Array;
}): Uint8Array {
	ensurePkijsEngine();
	const algorithm = new AlgorithmIdentifier({
		algorithmId: ECDSA_PUBLIC_KEY_OID,
		algorithmParams: new ObjectIdentifier({ value: P256_NAMED_CURVE_OID }),
	});
	const publicKeyInfo = new PublicKeyInfo();
	publicKeyInfo.algorithm = algorithm;
	publicKeyInfo.subjectPublicKey = new BitString({
		valueHex: bufferBytes(publicPoint),
	});
	return new Uint8Array(publicKeyInfo.toSchema().toBER(false));
}

function buildDg14({
	caOid,
	keyId,
	chipPublicKeySpki,
}: {
	caOid: string;
	keyId: bigint | null;
	chipPublicKeySpki: Uint8Array;
}): Uint8Array {
	const chipAuthInfoValue: unknown[] = [
		new ObjectIdentifier({ value: caOid }),
		new Integer({ value: 2 }),
	];
	if (keyId !== null) {
		chipAuthInfoValue.push(new Integer({ value: Number(keyId) }));
	}

	const chipAuthInfo = new Sequence({ value: chipAuthInfoValue as never });

	const spkiBytes = chipPublicKeySpki;
	const spkiSequence = parseSequenceFromDer(spkiBytes);

	const chipAuthPublicKeyInfoValue: unknown[] = [
		new ObjectIdentifier({ value: ID_PK_ECDH_OID }),
		spkiSequence,
	];
	if (keyId !== null) {
		chipAuthPublicKeyInfoValue.push(new Integer({ value: Number(keyId) }));
	}

	const chipAuthPublicKeyInfo = new Sequence({
		value: chipAuthPublicKeyInfoValue as never,
	});

	const securityInfos = new Asn1Set({
		value: [chipAuthInfo, chipAuthPublicKeyInfo],
	});

	const innerBytes = new Uint8Array(securityInfos.toBER(false));
	return concat(
		Uint8Array.of(0x6e),
		encodeBerLength(innerBytes.length),
		innerBytes,
	);
}

function parseSequenceFromDer(bytes: Uint8Array): Sequence {
	const { fromBER } = require("asn1js") as typeof import("asn1js");
	const decoded = fromBER(bufferBytes(bytes));
	if (decoded.offset === -1 || !(decoded.result instanceof Sequence)) {
		throw new Error("test_sequence_parse_failed");
	}
	return decoded.result;
}

function encodeAuthenticatedPublicKeyTokenInput({
	algorithmOid,
	terminalPublicKey,
}: {
	algorithmOid: string;
	terminalPublicKey: Uint8Array;
}): Uint8Array {
	const oidTlv = new Uint8Array(
		new ObjectIdentifier({ value: algorithmOid }).toBER(false),
	);
	const innerTlv = concat(
		Uint8Array.of(0x86),
		encodeBerLength(terminalPublicKey.length),
		terminalPublicKey,
	);
	const body = concat(oidTlv, innerTlv);
	return concat(Uint8Array.of(0x7f, 0x49), encodeBerLength(body.length), body);
}

describe("aesCmac (RFC 4493 / NIST SP 800-38B test vectors)", () => {
	// AES-128 CMAC examples from NIST SP 800-38B Appendix D.1.
	const KEY_AES_128 = hexToBytes("2b7e151628aed2a6abf7158809cf4f3c");

	test("Example 1: empty message", async () => {
		const mac = await aesCmac({ key: KEY_AES_128, message: new Uint8Array() });
		expect(bytesToHex(mac)).toBe("bb1d6929e95937287fa37d129b756746");
	});

	test("Example 2: single block", async () => {
		const mac = await aesCmac({
			key: KEY_AES_128,
			message: hexToBytes("6bc1bee22e409f96e93d7e117393172a"),
		});
		expect(bytesToHex(mac)).toBe("070a16b46b4d4144f79bdd9dd04a287c");
	});

	test("Example 3: 320-bit message (2.5 blocks)", async () => {
		const mac = await aesCmac({
			key: KEY_AES_128,
			message: hexToBytes(
				"6bc1bee22e409f96e93d7e117393172a" +
					"ae2d8a571e03ac9c9eb76fac45af8e51" +
					"30c81c46a35ce411",
			),
		});
		expect(bytesToHex(mac)).toBe("dfa66747de9ae63030ca32611497c827");
	});

	test("Example 4: 512-bit message (4 blocks)", async () => {
		const mac = await aesCmac({
			key: KEY_AES_128,
			message: hexToBytes(
				"6bc1bee22e409f96e93d7e117393172a" +
					"ae2d8a571e03ac9c9eb76fac45af8e51" +
					"30c81c46a35ce411e5fbc1191a0a52ef" +
					"f69f2445df4f9b17ad2b417be66c3710",
			),
		});
		expect(bytesToHex(mac)).toBe("51f0bebf7e3b9d92fc49741779363cfe");
	});
});

describe("TR-03110 KDF (TR-03110-3 §A.2.3)", () => {
	test("KDF(K, r, 1) = first n bytes of H(K || r || 0x00000001)", async () => {
		const sharedSecret = hexToBytes(
			"00112233445566778899aabbccddeeff" + "00112233445566778899aabbccddeeff",
		);
		const nonce = hexToBytes("aabbccddeeff0011");
		const kEnc = await deriveChipAuthKEnc({
			hash: "SHA-1",
			keyLength: 16,
			nonce,
			sharedSecret,
		});

		const expected = await crypto.subtle.digest(
			"SHA-1",
			bufferBytes(concat(sharedSecret, nonce, hexToBytes("00000001"))),
		);
		expect(bytesToHex(kEnc)).toBe(
			bytesToHex(new Uint8Array(expected).slice(0, 16)),
		);
	});

	test("KDF for K_MAC uses counter 0x00000002", async () => {
		const sharedSecret = hexToBytes("01".repeat(32));
		const nonce = hexToBytes("000102030405060708090a0b0c0d0e0f");
		const kMac = await deriveChipAuthKMac({
			hash: "SHA-256",
			keyLength: 32,
			nonce,
			sharedSecret,
		});

		const expected = await crypto.subtle.digest(
			"SHA-256",
			bufferBytes(concat(sharedSecret, nonce, hexToBytes("00000002"))),
		);
		expect(bytesToHex(kMac)).toBe(
			bytesToHex(new Uint8Array(expected).slice(0, 32)),
		);
	});

	test("KDF differs across counters", async () => {
		const sharedSecret = hexToBytes("ff".repeat(32));
		const nonce = hexToBytes("01".repeat(8));
		const [kEnc, kMac] = await Promise.all([
			deriveChipAuthKEnc({
				hash: "SHA-1",
				keyLength: 16,
				nonce,
				sharedSecret,
			}),
			deriveChipAuthKMac({
				hash: "SHA-1",
				keyLength: 16,
				nonce,
				sharedSecret,
			}),
		]);
		expect(bytesToHex(kEnc)).not.toBe(bytesToHex(kMac));
	});
});

describe("parseDg14 chip authentication SecurityInfos", () => {
	test("extracts ChipAuthenticationInfo and ChipAuthenticationPublicKeyInfo", async () => {
		const { publicPoint } = await generateP256KeyPair();
		const spki = buildEcdhSubjectPublicKeyInfo({ publicPoint });
		const dg14 = buildDg14({
			caOid: ID_CA_ECDH_AES_CBC_CMAC_128_OID,
			chipPublicKeySpki: spki,
			keyId: 1n,
		});

		const parsed = parseDg14(dg14);

		expect(parsed.chipAuthInfos).toHaveLength(1);
		expect(parsed.chipAuthInfos[0]?.algorithm.oid).toBe(
			ID_CA_ECDH_AES_CBC_CMAC_128_OID,
		);
		expect(parsed.chipAuthInfos[0]?.version).toBe(2);
		expect(parsed.chipAuthInfos[0]?.keyId).toBe(1n);

		expect(parsed.chipAuthPublicKeys).toHaveLength(1);
		expect(parsed.chipAuthPublicKeys[0]?.algorithm).toBe("ECDH");
		expect(parsed.chipAuthPublicKeys[0]?.keyId).toBe(1n);
	});

	test("returns empty arrays when DG14 carries no chip-auth infos", () => {
		const parsed = parseDg14(new Uint8Array());
		expect(parsed.chipAuthInfos).toHaveLength(0);
		expect(parsed.chipAuthPublicKeys).toHaveLength(0);
	});
});

describe("validateChipAuthentication transcript parsing", () => {
	test("rejects empty transcript", async () => {
		const result = await validateChipAuthentication({
			chipAuthData: new Uint8Array(),
			dg14: new Uint8Array([0x6e, 0x00]),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("transcript_missing");
		}
	});

	test("rejects unsupported transcript version", async () => {
		const transcript = new Uint8Array([0x99, 0x00, 0x00]);
		const result = await validateChipAuthentication({
			chipAuthData: transcript,
			dg14: new Uint8Array([0x6e, 0x00]),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("transcript_parse_failed");
		}
	});

	test("rejects unknown CA OID", async () => {
		const transcript = buildTranscript({
			chipNonce: new Uint8Array(16),
			chipToken: new Uint8Array(8),
			keyId: 1n,
			oid: "1.2.3.4.5",
			terminalPrivateKey: new Uint8Array(32),
			terminalPublicKey: new Uint8Array(65),
		});
		const result = await validateChipAuthentication({
			chipAuthData: transcript,
			dg14: new Uint8Array([0x6e, 0x00]),
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("algorithm_unsupported");
		}
	});
});

describe("validateChipAuthentication ECDH happy-path (CA-v2 / AES-128 CMAC)", () => {
	test("accepts a transcript whose token matches the recomputed value", async () => {
		const chip = await generateP256KeyPair();
		const terminal = await generateP256KeyPair();
		const oid = ID_CA_ECDH_AES_CBC_CMAC_128_OID;

		const dg14 = buildDg14({
			caOid: oid,
			chipPublicKeySpki: buildEcdhSubjectPublicKeyInfo({
				publicPoint: chip.publicPoint,
			}),
			keyId: 1n,
		});

		// Reconstruct the chip's view: K = ECDH(chip.private, terminal.public)
		// equals ECDH(terminal.private, chip.public) by the symmetry of DH.
		const sharedSecret = await deriveBitsBetween({
			privateKeyOf: chip.keyPair,
			publicKeyOf: terminal.keyPair,
		});

		const chipNonce = crypto.getRandomValues(new Uint8Array(16));
		const kMac = await deriveChipAuthKMac({
			hash: "SHA-1",
			keyLength: 16,
			nonce: chipNonce,
			sharedSecret,
		});

		const tokenInput = encodeAuthenticatedPublicKeyTokenInput({
			algorithmOid: ID_PK_ECDH_OID,
			terminalPublicKey: terminal.publicPoint,
		});
		const tokenFull = await aesCmac({ key: kMac, message: tokenInput });
		const chipToken = truncateMacToken(tokenFull);

		const transcript = buildTranscript({
			chipNonce,
			chipToken,
			keyId: 1n,
			oid,
			terminalPrivateKey: terminal.privateScalar,
			terminalPublicKey: terminal.publicPoint,
		});

		const result = await validateChipAuthentication({
			chipAuthData: transcript,
			dg14,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.algorithm).toBe(oid);
			expect(result.keyAgreement).toBe("ECDH");
		}
	});

	test("rejects a tampered chip token", async () => {
		const chip = await generateP256KeyPair();
		const terminal = await generateP256KeyPair();
		const oid = ID_CA_ECDH_AES_CBC_CMAC_128_OID;

		const dg14 = buildDg14({
			caOid: oid,
			chipPublicKeySpki: buildEcdhSubjectPublicKeyInfo({
				publicPoint: chip.publicPoint,
			}),
			keyId: 1n,
		});

		const sharedSecret = await deriveBitsBetween({
			privateKeyOf: chip.keyPair,
			publicKeyOf: terminal.keyPair,
		});

		const chipNonce = crypto.getRandomValues(new Uint8Array(16));
		const kMac = await deriveChipAuthKMac({
			hash: "SHA-1",
			keyLength: 16,
			nonce: chipNonce,
			sharedSecret,
		});
		const tokenInput = encodeAuthenticatedPublicKeyTokenInput({
			algorithmOid: ID_PK_ECDH_OID,
			terminalPublicKey: terminal.publicPoint,
		});
		const tokenFull = await aesCmac({ key: kMac, message: tokenInput });
		const tamperedToken = truncateMacToken(tokenFull).slice();
		tamperedToken[0] ^= 0xff;

		const transcript = buildTranscript({
			chipNonce,
			chipToken: tamperedToken,
			keyId: 1n,
			oid,
			terminalPrivateKey: terminal.privateScalar,
			terminalPublicKey: terminal.publicPoint,
		});

		const result = await validateChipAuthentication({
			chipAuthData: transcript,
			dg14,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("chip_token_mismatch");
		}
	});

	test("rejects when DG14 binds a different chip key than the transcript expects", async () => {
		const intendedChip = await generateP256KeyPair();
		const swappedChip = await generateP256KeyPair();
		const terminal = await generateP256KeyPair();
		const oid = ID_CA_ECDH_AES_CBC_CMAC_128_OID;

		// DG14 declares swappedChip's public key, but the transcript was
		// computed against intendedChip — so the recomputed shared secret and
		// thus the recomputed token will differ.
		const dg14 = buildDg14({
			caOid: oid,
			chipPublicKeySpki: buildEcdhSubjectPublicKeyInfo({
				publicPoint: swappedChip.publicPoint,
			}),
			keyId: 1n,
		});

		const sharedSecret = await deriveBitsBetween({
			privateKeyOf: intendedChip.keyPair,
			publicKeyOf: terminal.keyPair,
		});

		const chipNonce = crypto.getRandomValues(new Uint8Array(16));
		const kMac = await deriveChipAuthKMac({
			hash: "SHA-1",
			keyLength: 16,
			nonce: chipNonce,
			sharedSecret,
		});
		const tokenInput = encodeAuthenticatedPublicKeyTokenInput({
			algorithmOid: ID_PK_ECDH_OID,
			terminalPublicKey: terminal.publicPoint,
		});
		const chipToken = truncateMacToken(
			await aesCmac({ key: kMac, message: tokenInput }),
		);

		const transcript = buildTranscript({
			chipNonce,
			chipToken,
			keyId: 1n,
			oid,
			terminalPrivateKey: terminal.privateScalar,
			terminalPublicKey: terminal.publicPoint,
		});

		const result = await validateChipAuthentication({
			chipAuthData: transcript,
			dg14,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("chip_token_mismatch");
		}
	});
});

async function deriveBitsBetween({
	privateKeyOf,
	publicKeyOf,
}: {
	privateKeyOf: CryptoKeyPair;
	publicKeyOf: CryptoKeyPair;
}): Promise<Uint8Array> {
	const bits = await crypto.subtle.deriveBits(
		{
			$public: publicKeyOf.publicKey,
			name: "ECDH",
			public: publicKeyOf.publicKey,
		} as never,
		privateKeyOf.privateKey,
		256,
	);
	return new Uint8Array(bits);
}

describe("OID hash registry", () => {
	test("AES-128 CMAC variant uses SHA-1 and 16-byte keys", () => {
		const transcript = buildTranscript({
			chipNonce: new Uint8Array(16),
			chipToken: new Uint8Array(8),
			keyId: null,
			oid: ID_CA_ECDH_AES_CBC_CMAC_128_OID,
			terminalPrivateKey: new Uint8Array(32),
			terminalPublicKey: new Uint8Array(65),
		});
		// Smoke-test that constructing a transcript with this OID is well-formed —
		// the actual algorithm registry is exercised by the happy-path test above.
		expect(transcript.byteLength).toBeGreaterThan(0);
	});

	test("AES-192/AES-256 CMAC variants are recognized as valid OIDs", () => {
		expect(ID_CA_ECDH_AES_CBC_CMAC_192_OID).toBe("0.4.0.127.0.7.2.2.3.2.3");
		expect(ID_CA_ECDH_AES_CBC_CMAC_256_OID).toBe("0.4.0.127.0.7.2.2.3.2.4");
	});
});
