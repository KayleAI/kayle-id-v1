import { describe, expect, test } from "bun:test";
import {
	computeAppAttestRpIdHash,
	verifyAssertion,
	verifyAttestation,
} from "@/v1/verify/app-attest";

const APP_ID_RP_HASH_HEX_LEN = 64; // SHA-256 of "K667TL7H29.kayle.id" → 32 bytes → 64 hex.

describe("computeAppAttestRpIdHash", () => {
	test("returns 32 bytes", async () => {
		const hash = await computeAppAttestRpIdHash();
		expect(hash.length).toBe(32);
	});

	test("is deterministic", async () => {
		const a = await computeAppAttestRpIdHash();
		const b = await computeAppAttestRpIdHash();
		expect(toHex(a)).toBe(toHex(b));
		expect(toHex(a).length).toBe(APP_ID_RP_HASH_HEX_LEN);
	});

	test("matches SHA-256(K667TL7H29.kayle.id)", async () => {
		const hash = await computeAppAttestRpIdHash();
		const expected = new Uint8Array(
			await crypto.subtle.digest(
				"SHA-256",
				new TextEncoder().encode("K667TL7H29.kayle.id"),
			),
		);
		expect(toHex(hash)).toBe(toHex(expected));
	});
});

describe("verifyAttestation negative paths", () => {
	test("rejects empty CBOR with cbor_decode_failed", async () => {
		const result = await verifyAttestation({
			attestationCbor: new Uint8Array(),
			clientDataHash: new Uint8Array(32),
			environment: "production",
			keyId: new Uint8Array(32),
		});

		expect(result.ok).toBeFalse();
		if (!result.ok) {
			expect(result.reason).toBe("cbor_decode_failed");
		}
	});

	test("rejects garbage bytes with cbor_decode_failed", async () => {
		const result = await verifyAttestation({
			attestationCbor: Uint8Array.of(0xff, 0xff, 0xff, 0xff),
			clientDataHash: new Uint8Array(32),
			environment: "production",
			keyId: new Uint8Array(32),
		});

		expect(result.ok).toBeFalse();
		if (!result.ok) {
			expect(result.reason).toBe("cbor_decode_failed");
		}
	});

	test("rejects wrong fmt with fmt_unexpected", async () => {
		const cbor = encodeCborMap([
			[encodeCborText("fmt"), encodeCborText("not-apple-appattest")],
			[
				encodeCborText("attStmt"),
				encodeCborMap([
					[
						encodeCborText("x5c"),
						encodeCborArray([encodeCborBytes(Uint8Array.of(0x30, 0x00))]),
					],
					[encodeCborText("receipt"), encodeCborBytes(Uint8Array.of(0x01))],
				]),
			],
			[encodeCborText("authData"), encodeCborBytes(new Uint8Array(64))],
		]);

		const result = await verifyAttestation({
			attestationCbor: cbor,
			clientDataHash: new Uint8Array(32),
			environment: "production",
			keyId: new Uint8Array(32),
		});

		expect(result.ok).toBeFalse();
		if (!result.ok) {
			expect(result.reason).toBe("fmt_unexpected");
		}
	});

	test("rejects empty x5c with x5c_missing", async () => {
		const cbor = encodeCborMap([
			[encodeCborText("fmt"), encodeCborText("apple-appattest")],
			[
				encodeCborText("attStmt"),
				encodeCborMap([
					[encodeCborText("x5c"), encodeCborArray([])],
					[encodeCborText("receipt"), encodeCborBytes(Uint8Array.of(0x01))],
				]),
			],
			[encodeCborText("authData"), encodeCborBytes(new Uint8Array(64))],
		]);

		const result = await verifyAttestation({
			attestationCbor: cbor,
			clientDataHash: new Uint8Array(32),
			environment: "production",
			keyId: new Uint8Array(32),
		});

		expect(result.ok).toBeFalse();
		if (!result.ok) {
			expect(result.reason).toBe("x5c_missing");
		}
	});

	test("rejects empty receipt with receipt_missing", async () => {
		const cbor = encodeCborMap([
			[encodeCborText("fmt"), encodeCborText("apple-appattest")],
			[
				encodeCborText("attStmt"),
				encodeCborMap([
					[
						encodeCborText("x5c"),
						encodeCborArray([encodeCborBytes(Uint8Array.of(0x30, 0x00))]),
					],
					[encodeCborText("receipt"), encodeCborBytes(new Uint8Array())],
				]),
			],
			[encodeCborText("authData"), encodeCborBytes(new Uint8Array(64))],
		]);

		const result = await verifyAttestation({
			attestationCbor: cbor,
			clientDataHash: new Uint8Array(32),
			environment: "production",
			keyId: new Uint8Array(32),
		});

		expect(result.ok).toBeFalse();
		if (!result.ok) {
			expect(result.reason).toBe("receipt_missing");
		}
	});
});

describe("verifyAssertion happy + negative paths", () => {
	test("accepts a freshly-signed assertion and reports the new counter", async () => {
		const fixture = await buildAssertionFixture({ counter: 7 });
		const result = await verifyAssertion(fixture.input);

		expect(result.ok).toBeTrue();
		if (result.ok) {
			expect(result.counter).toBe(7);
		}
	});

	test("rejects when authenticatorData is shorter than the rpIdHash slot", async () => {
		const fixture = await buildAssertionFixture({ counter: 1 });
		const truncated = {
			...fixture.input,
			assertionCbor: encodeCborMap([
				[
					encodeCborText("authenticatorData"),
					encodeCborBytes(new Uint8Array(10)),
				],
				[encodeCborText("signature"), encodeCborBytes(new Uint8Array(70))],
			]),
		};

		const result = await verifyAssertion(truncated);
		expect(result.ok).toBeFalse();
		if (!result.ok) {
			expect(result.reason).toBe("auth_data_truncated");
		}
	});

	test("rejects assertion bound to a different rpIdHash", async () => {
		const fixture = await buildAssertionFixture({ counter: 5 });
		const wrongRpHash = new Uint8Array(32).fill(0xab);
		const result = await verifyAssertion({
			...fixture.input,
			expectedRpIdHash: wrongRpHash,
		});

		expect(result.ok).toBeFalse();
		if (!result.ok) {
			expect(result.reason).toBe("rp_id_hash_mismatch");
		}
	});

	test("rejects when counter does not advance past lastCounter", async () => {
		const fixture = await buildAssertionFixture({ counter: 5 });
		const result = await verifyAssertion({
			...fixture.input,
			lastCounter: 5,
		});

		expect(result.ok).toBeFalse();
		if (!result.ok) {
			expect(result.reason).toBe("counter_regressed");
		}
	});

	test("rejects when counter regresses below lastCounter", async () => {
		const fixture = await buildAssertionFixture({ counter: 5 });
		const result = await verifyAssertion({
			...fixture.input,
			lastCounter: 99,
		});

		expect(result.ok).toBeFalse();
		if (!result.ok) {
			expect(result.reason).toBe("counter_regressed");
		}
	});

	test("rejects assertion whose signature was forged", async () => {
		const fixture = await buildAssertionFixture({ counter: 5 });
		const forgedAssertion = encodeCborMap([
			[
				encodeCborText("authenticatorData"),
				encodeCborBytes(fixture.authenticatorData),
			],
			[
				encodeCborText("signature"),
				encodeCborBytes(forgedSignatureBytes(fixture.derSignature)),
			],
		]);

		const result = await verifyAssertion({
			...fixture.input,
			assertionCbor: forgedAssertion,
		});

		expect(result.ok).toBeFalse();
		if (!result.ok) {
			expect(result.reason).toBe("signature_invalid");
		}
	});
});

// ---- assertion fixture builders --------------------------------------------

type AssertionFixture = {
	authenticatorData: Uint8Array;
	derSignature: Uint8Array;
	input: Parameters<typeof verifyAssertion>[0];
};

async function buildAssertionFixture({
	counter,
}: {
	counter: number;
}): Promise<AssertionFixture> {
	const keyPair = (await crypto.subtle.generateKey(
		{ name: "ECDSA", namedCurve: "P-256" },
		true,
		["sign", "verify"],
	)) as CryptoKeyPair;

	const jwk = (await crypto.subtle.exportKey(
		"jwk",
		keyPair.publicKey,
	)) as JsonWebKey;
	const x = base64UrlToBytes(jwk.x ?? "");
	const y = base64UrlToBytes(jwk.y ?? "");
	const publicKeyCose = encodeCoseEc2P256({ x, y });

	const expectedRpIdHash = await computeAppAttestRpIdHash();
	const flags = Uint8Array.of(0x00);
	const counterBytes = uint32BE(counter);
	const authenticatorData = concat(expectedRpIdHash, flags, counterBytes);

	const clientDataHash = new Uint8Array(32).fill(0x42);
	const nonce = new Uint8Array(
		await crypto.subtle.digest(
			"SHA-256",
			concat(authenticatorData, clientDataHash) as unknown as ArrayBuffer,
		),
	);
	const ieeeP1363Sig = new Uint8Array(
		await crypto.subtle.sign(
			{ hash: "SHA-256", name: "ECDSA" },
			keyPair.privateKey,
			nonce as unknown as ArrayBuffer,
		),
	);
	const derSignature = ieeeP1363ToDer(ieeeP1363Sig);

	const assertionCbor = encodeCborMap([
		[encodeCborText("authenticatorData"), encodeCborBytes(authenticatorData)],
		[encodeCborText("signature"), encodeCborBytes(derSignature)],
	]);

	return {
		authenticatorData,
		derSignature,
		input: {
			assertionCbor,
			clientDataHash,
			expectedRpIdHash,
			lastCounter: 0,
			publicKeyCose,
		},
	};
}

function forgedSignatureBytes(real: Uint8Array): Uint8Array {
	// Flip the last r-byte and last s-byte. Still parses as DER, still has the
	// right shape, but the signature won't verify.
	const out = new Uint8Array(real);
	if (out.length > 4) {
		out[out.length - 1] = ((out[out.length - 1] ?? 0) ^ 0x55) & 0xff;
		const middle = Math.floor(out.length / 2);
		out[middle] = ((out[middle] ?? 0) ^ 0xaa) & 0xff;
	}
	return out;
}

// ---- COSE EC2 P-256 encoder ------------------------------------------------

function encodeCoseEc2P256({
	x,
	y,
}: {
	x: Uint8Array;
	y: Uint8Array;
}): Uint8Array {
	return encodeCborMap([
		[encodeCborInt(1), encodeCborInt(2)],
		[encodeCborInt(3), encodeCborNegativeInt(7)],
		[encodeCborNegativeInt(1), encodeCborInt(1)],
		[encodeCborNegativeInt(2), encodeCborBytes(x)],
		[encodeCborNegativeInt(3), encodeCborBytes(y)],
	]);
}

// ---- minimal CBOR encoder (canonical-enough for our verifier) -------------

function encodeCborMap(pairs: [Uint8Array, Uint8Array][]): Uint8Array {
	const head = encodeCborHeader(5, pairs.length);
	const parts: Uint8Array[] = [head];
	for (const [k, v] of pairs) {
		parts.push(k);
		parts.push(v);
	}
	return concat(...parts);
}

function encodeCborArray(items: Uint8Array[]): Uint8Array {
	return concat(encodeCborHeader(4, items.length), ...items);
}

function encodeCborText(text: string): Uint8Array {
	const bytes = new TextEncoder().encode(text);
	return concat(encodeCborHeader(3, bytes.length), bytes);
}

function encodeCborBytes(bytes: Uint8Array): Uint8Array {
	return concat(encodeCborHeader(2, bytes.length), bytes);
}

function encodeCborInt(value: number): Uint8Array {
	if (value < 0) {
		throw new Error("encodeCborInt expects a non-negative int");
	}
	return encodeCborHeader(0, value);
}

function encodeCborNegativeInt(positiveLabel: number): Uint8Array {
	// CBOR major type 1 encodes -1 - n. Apple's COSE uses negative key labels
	// like -1, -2, -3 — encode the absolute value here as `positiveLabel` so
	// callers stay readable.
	if (positiveLabel < 1) {
		throw new Error("negative label must be >= 1");
	}
	return encodeCborHeader(1, positiveLabel - 1);
}

function encodeCborHeader(major: number, value: number): Uint8Array {
	const tag = (major & 0x07) << 5;
	if (value < 24) {
		return Uint8Array.of(tag | (value & 0x1f));
	}
	if (value < 0x100) {
		return Uint8Array.of(tag | 24, value);
	}
	if (value < 0x10000) {
		return Uint8Array.of(tag | 25, (value >> 8) & 0xff, value & 0xff);
	}
	if (value < 0x1_0000_0000) {
		return Uint8Array.of(
			tag | 26,
			(value >>> 24) & 0xff,
			(value >>> 16) & 0xff,
			(value >>> 8) & 0xff,
			value & 0xff,
		);
	}
	throw new Error("CBOR length too large for this test encoder");
}

// ---- byte helpers ---------------------------------------------------------

function uint32BE(value: number): Uint8Array {
	const out = new Uint8Array(4);
	out[0] = (value >>> 24) & 0xff;
	out[1] = (value >>> 16) & 0xff;
	out[2] = (value >>> 8) & 0xff;
	out[3] = value & 0xff;
	return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
	let total = 0;
	for (const part of parts) {
		total += part.length;
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

function toHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

function base64UrlToBytes(input: string): Uint8Array {
	const padded = input.replace(/-/g, "+").replace(/_/g, "/");
	const padLen = (4 - (padded.length % 4)) % 4;
	const binary = atob(padded + "=".repeat(padLen));
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		out[i] = binary.charCodeAt(i);
	}
	return out;
}

// ---- IEEE P1363 (raw r||s) → DER ECDSA signature -------------------------

function ieeeP1363ToDer(raw: Uint8Array): Uint8Array {
	if (raw.length !== 64) {
		throw new Error("expected 64-byte raw P-256 signature");
	}
	const r = trimLeadingZeros(raw.slice(0, 32));
	const s = trimLeadingZeros(raw.slice(32));
	const rDer = encodeAsn1Integer(r);
	const sDer = encodeAsn1Integer(s);
	const seqContents = concat(rDer, sDer);
	return concat(Uint8Array.of(0x30, seqContents.length), seqContents);
}

function trimLeadingZeros(bytes: Uint8Array): Uint8Array {
	let start = 0;
	while (start < bytes.length - 1 && bytes[start] === 0x00) {
		start += 1;
	}
	return bytes.slice(start);
}

function encodeAsn1Integer(value: Uint8Array): Uint8Array {
	const needsPad = (value[0] ?? 0) & 0x80;
	const body = needsPad ? concat(Uint8Array.of(0x00), value) : value;
	return concat(Uint8Array.of(0x02, body.length), body);
}
