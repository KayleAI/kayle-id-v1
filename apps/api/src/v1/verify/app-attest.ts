import { Certificate, CertificateChainValidationEngine } from "pkijs";
import { getAppAttestRootCertPem } from "./app-attest-trust";
import { ensurePkijsEngine } from "./pkd-trust";
import { bytesEqual } from "./sod-asn1-utils";

/**
 * Apple App Attest verifier. Two entry points:
 *
 *   - `verifyAttestation` — runs once per install, when the iOS client
 *     registers a freshly-minted Secure-Enclave key. Validates the chain to
 *     Apple's pinned App Attest Root CA, the credCert nonce extension, the
 *     authData rpIdHash / counter / aaguid, and that the supplied keyId
 *     matches `SHA-256(credCert.subjectPublicKey)`. Returns the COSE-encoded
 *     public key plus Apple's receipt for later riskMetric refresh.
 *
 *   - `verifyAssertion` — runs once per request that needs to be bound to a
 *     hardware-attested key. Validates the ECDSA signature over the assertion
 *     `nonce = SHA-256(authenticatorData ‖ clientDataHash)` with the stored
 *     COSE public key, plus the rpIdHash and counter monotonicity.
 *
 * The verifier is pure: no DB access, no network. Persistence and replay
 * protection live one layer up (`hello-auth.ts`, `socket-phase-validation.ts`)
 * so this module stays unit-testable in isolation.
 */

const APP_ATTEST_FMT = "apple-appattest";
const APP_ATTEST_RP_ID = "K667TL7H29.kayle.id";

// Apple's well-documented AAGUID values. The CBOR authData field at offset
// 37..53 carries one of these as a 16-byte ASCII-padded label.
const AAGUID_PRODUCTION = utf8FixedLength("appattest", 16);
const AAGUID_DEVELOPMENT = utf8FixedLength("appattestdevelop", 16);

// OID `1.2.840.113635.100.8.2` (Apple's nonce extension on the attested
// credCert). Encoded here as the value bytes that follow ASN.1 tag/length so
// we can compare against the parsed extension's `extnID` string directly.
const APPLE_NONCE_EXTENSION_OID = "1.2.840.113635.100.8.2";

const COSE_EC2_KTY = 2;
const COSE_ALG_ES256 = -7;
const COSE_CRV_P256 = 1;
const COSE_KEY_OPS_SIGN = 1;

const AUTH_DATA_RP_ID_HASH_OFFSET = 0;
const AUTH_DATA_FLAGS_OFFSET = 32;
const AUTH_DATA_COUNTER_OFFSET = 33;
const AUTH_DATA_AAGUID_OFFSET = 37;
const AUTH_DATA_CRED_ID_LEN_OFFSET = 53;
const AUTH_DATA_CRED_ID_OFFSET = 55;

export type AppAttestEnvironment = "production" | "development";

export type AttestationFailureReason =
	| "cbor_decode_failed"
	| "fmt_unexpected"
	| "x5c_missing"
	| "cert_parse_failed"
	| "cert_chain_invalid"
	| "auth_data_truncated"
	| "rp_id_hash_mismatch"
	| "counter_not_zero"
	| "aaguid_mismatch"
	| "key_id_mismatch"
	| "nonce_extension_missing"
	| "nonce_mismatch"
	| "credential_id_mismatch"
	| "cose_public_key_invalid"
	| "receipt_missing";

export type AssertionFailureReason =
	| "cbor_decode_failed"
	| "auth_data_truncated"
	| "rp_id_hash_mismatch"
	| "counter_regressed"
	| "signature_decode_failed"
	| "signature_invalid"
	| "public_key_invalid";

export type AttestationVerificationResult =
	| {
			ok: true;
			publicKeyCose: Uint8Array;
			receipt: Uint8Array;
			counter: number;
	  }
	| { ok: false; reason: AttestationFailureReason; detail?: string };

export type AssertionVerificationResult =
	| { ok: true; counter: number }
	| { ok: false; reason: AssertionFailureReason; detail?: string };

export async function verifyAttestation({
	keyId,
	attestationCbor,
	clientDataHash,
	environment,
}: {
	keyId: Uint8Array;
	attestationCbor: Uint8Array;
	clientDataHash: Uint8Array;
	environment: AppAttestEnvironment;
}): Promise<AttestationVerificationResult> {
	let decoded: AttestationCbor;
	try {
		decoded = decodeAttestationCbor(attestationCbor);
	} catch (error) {
		return {
			ok: false,
			reason: "cbor_decode_failed",
			detail: error instanceof Error ? error.message : undefined,
		};
	}

	if (decoded.fmt !== APP_ATTEST_FMT) {
		return { ok: false, reason: "fmt_unexpected", detail: decoded.fmt };
	}

	if (decoded.attStmt.x5c.length === 0) {
		return { ok: false, reason: "x5c_missing" };
	}

	if (decoded.attStmt.receipt.length === 0) {
		return { ok: false, reason: "receipt_missing" };
	}

	ensurePkijsEngine();

	let credCert: Certificate;
	let chain: Certificate[];
	try {
		chain = decoded.attStmt.x5c.map((der) =>
			Certificate.fromBER(toAlignedArrayBuffer(der)),
		);
		credCert = chain[0] as Certificate;
	} catch (error) {
		return {
			ok: false,
			reason: "cert_parse_failed",
			detail: error instanceof Error ? error.message : undefined,
		};
	}

	const rootCert = parseRootCertFromPem(getAppAttestRootCertPem());
	const chainValid = await new CertificateChainValidationEngine({
		certs: chain,
		trustedCerts: [rootCert],
	}).verify();

	if (!chainValid.result) {
		return {
			ok: false,
			reason: "cert_chain_invalid",
			detail: chainValid.resultMessage,
		};
	}

	const authData = decoded.authData;
	if (authData.length < AUTH_DATA_CRED_ID_OFFSET) {
		return { ok: false, reason: "auth_data_truncated" };
	}

	const expectedRpIdHash = await sha256(
		new TextEncoder().encode(APP_ATTEST_RP_ID),
	);
	const rpIdHash = authData.slice(
		AUTH_DATA_RP_ID_HASH_OFFSET,
		AUTH_DATA_FLAGS_OFFSET,
	);
	if (!bytesEqual(rpIdHash, expectedRpIdHash)) {
		return { ok: false, reason: "rp_id_hash_mismatch" };
	}

	const counter = readUint32BE(authData, AUTH_DATA_COUNTER_OFFSET);
	if (counter !== 0) {
		return {
			ok: false,
			reason: "counter_not_zero",
			detail: String(counter),
		};
	}

	const aaguid = authData.slice(
		AUTH_DATA_AAGUID_OFFSET,
		AUTH_DATA_CRED_ID_LEN_OFFSET,
	);
	const expectedAaguid =
		environment === "production" ? AAGUID_PRODUCTION : AAGUID_DEVELOPMENT;
	if (!bytesEqual(aaguid, expectedAaguid)) {
		return { ok: false, reason: "aaguid_mismatch" };
	}

	const credIdLen =
		(authData[AUTH_DATA_CRED_ID_LEN_OFFSET] ?? 0) * 256 +
		(authData[AUTH_DATA_CRED_ID_LEN_OFFSET + 1] ?? 0);
	const credIdEnd = AUTH_DATA_CRED_ID_OFFSET + credIdLen;
	if (credIdEnd > authData.length) {
		return { ok: false, reason: "auth_data_truncated" };
	}
	const credId = authData.slice(AUTH_DATA_CRED_ID_OFFSET, credIdEnd);

	const subjectPublicKeyDer = exportSubjectPublicKey(credCert);
	const credCertPubKeyHash = await sha256(subjectPublicKeyDer);

	if (!bytesEqual(credId, credCertPubKeyHash)) {
		return { ok: false, reason: "credential_id_mismatch" };
	}
	if (!bytesEqual(keyId, credCertPubKeyHash)) {
		return { ok: false, reason: "key_id_mismatch" };
	}

	const expectedNonce = await sha256(concat(authData, clientDataHash));
	const credCertNonce = extractAppleNonceExtension(credCert);
	if (!credCertNonce) {
		return { ok: false, reason: "nonce_extension_missing" };
	}
	if (!bytesEqual(credCertNonce, expectedNonce)) {
		return { ok: false, reason: "nonce_mismatch" };
	}

	let cosePublicKey: Uint8Array;
	try {
		cosePublicKey = authData.slice(credIdEnd);
		// Sanity: ensure it parses as an EC2 P-256 COSE key. We don't keep the
		// parsed form — we re-parse on assertion verification to keep a single
		// canonical decoder path.
		parseCoseEc2Key(cosePublicKey);
	} catch (error) {
		return {
			ok: false,
			reason: "cose_public_key_invalid",
			detail: error instanceof Error ? error.message : undefined,
		};
	}

	return {
		ok: true,
		publicKeyCose: cosePublicKey,
		receipt: decoded.attStmt.receipt,
		counter,
	};
}

export async function verifyAssertion({
	assertionCbor,
	publicKeyCose,
	clientDataHash,
	expectedRpIdHash,
	lastCounter,
}: {
	assertionCbor: Uint8Array;
	publicKeyCose: Uint8Array;
	clientDataHash: Uint8Array;
	expectedRpIdHash: Uint8Array;
	lastCounter: number;
}): Promise<AssertionVerificationResult> {
	let decoded: AssertionCbor;
	try {
		decoded = decodeAssertionCbor(assertionCbor);
	} catch (error) {
		return {
			ok: false,
			reason: "cbor_decode_failed",
			detail: error instanceof Error ? error.message : undefined,
		};
	}

	if (decoded.authenticatorData.length < AUTH_DATA_AAGUID_OFFSET) {
		return { ok: false, reason: "auth_data_truncated" };
	}

	const rpIdHash = decoded.authenticatorData.slice(
		AUTH_DATA_RP_ID_HASH_OFFSET,
		AUTH_DATA_FLAGS_OFFSET,
	);
	if (!bytesEqual(rpIdHash, expectedRpIdHash)) {
		return { ok: false, reason: "rp_id_hash_mismatch" };
	}

	const counter = readUint32BE(
		decoded.authenticatorData,
		AUTH_DATA_COUNTER_OFFSET,
	);
	if (counter <= lastCounter) {
		return {
			ok: false,
			reason: "counter_regressed",
			detail: `counter=${counter} lastCounter=${lastCounter}`,
		};
	}

	let coseKey: { x: Uint8Array; y: Uint8Array };
	try {
		coseKey = parseCoseEc2Key(publicKeyCose);
	} catch (error) {
		return {
			ok: false,
			reason: "public_key_invalid",
			detail: error instanceof Error ? error.message : undefined,
		};
	}

	let signatureRaw: Uint8Array;
	try {
		signatureRaw = derEcdsaToRaw(decoded.signature, 32);
	} catch (error) {
		return {
			ok: false,
			reason: "signature_decode_failed",
			detail: error instanceof Error ? error.message : undefined,
		};
	}

	const nonce = await sha256(concat(decoded.authenticatorData, clientDataHash));

	const cryptoKey = await crypto.subtle.importKey(
		"jwk",
		{
			crv: "P-256",
			ext: true,
			key_ops: ["verify"],
			kty: "EC",
			x: bytesToBase64Url(coseKey.x),
			y: bytesToBase64Url(coseKey.y),
		},
		{ name: "ECDSA", namedCurve: "P-256" },
		false,
		["verify"],
	);

	const ok = await crypto.subtle.verify(
		{ hash: "SHA-256", name: "ECDSA" },
		cryptoKey,
		signatureRaw as unknown as ArrayBuffer,
		nonce as unknown as ArrayBuffer,
	);

	if (!ok) {
		return { ok: false, reason: "signature_invalid" };
	}

	return { ok: true, counter };
}

export function computeAppAttestRpIdHash(): Promise<Uint8Array> {
	return sha256(new TextEncoder().encode(APP_ATTEST_RP_ID));
}

// ---- CBOR decoding ----------------------------------------------------------
//
// App Attest's CBOR shape is constrained enough that we don't pull a general
// decoder. We support: positive ints (0..2^32-1), negative ints down to -32,
// byte strings, text strings, arrays, maps. Anything else throws.

type CborValue =
	| number
	| string
	| Uint8Array
	| CborValue[]
	| Map<CborValue, CborValue>;

type AttestationCbor = {
	fmt: string;
	attStmt: { x5c: Uint8Array[]; receipt: Uint8Array };
	authData: Uint8Array;
};

type AssertionCbor = {
	signature: Uint8Array;
	authenticatorData: Uint8Array;
};

function decodeAttestationCbor(bytes: Uint8Array): AttestationCbor {
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

function decodeAssertionCbor(bytes: Uint8Array): AssertionCbor {
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

function mapGet(map: Map<CborValue, CborValue>, key: string): CborValue {
	for (const [k, v] of map) {
		if (k === key) return v;
	}
	throw new Error(`cbor_map_missing_key:${key}`);
}

function decodeCbor(
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

// ---- COSE EC2 key parsing ---------------------------------------------------

function parseCoseEc2Key(bytes: Uint8Array): { x: Uint8Array; y: Uint8Array } {
	const { value } = decodeCbor(bytes, 0);
	if (!(value instanceof Map)) {
		throw new Error("cose_key_not_map");
	}

	const kty = coseGet(value, 1);
	const alg = coseGet(value, 3);
	const crv = coseGet(value, -1);
	const x = coseGet(value, -2);
	const y = coseGet(value, -3);

	if (kty !== COSE_EC2_KTY) throw new Error("cose_kty_not_ec2");
	if (alg !== COSE_ALG_ES256) throw new Error("cose_alg_not_es256");
	if (crv !== COSE_CRV_P256) throw new Error("cose_crv_not_p256");
	if (!(x instanceof Uint8Array) || x.length !== 32) {
		throw new Error("cose_x_invalid");
	}
	if (!(y instanceof Uint8Array) || y.length !== 32) {
		throw new Error("cose_y_invalid");
	}

	return { x, y };
}

function coseGet(map: Map<CborValue, CborValue>, key: number): CborValue {
	for (const [k, v] of map) {
		if (k === key) return v;
	}
	throw new Error(`cose_key_missing:${key}`);
}

// `key_ops` is a useful sanity but not all attestations include it; the
// constant exists to document the COSE label without forcing it to be present.
void COSE_KEY_OPS_SIGN;

// ---- Apple nonce extension --------------------------------------------------

function extractAppleNonceExtension(cert: Certificate): Uint8Array | null {
	const extensions = cert.extensions ?? [];
	for (const ext of extensions) {
		if (ext.extnID !== APPLE_NONCE_EXTENSION_OID) continue;
		const inner = (
			ext as unknown as {
				extnValue: { valueBlock: { valueHexView: Uint8Array } };
			}
		).extnValue.valueBlock.valueHexView;
		// The extension wraps SEQUENCE { [1] EXPLICIT OCTET STRING nonce }. We
		// don't pull pkijs's full ASN.1 schema for it — Apple specifies the
		// nonce is the only payload and is exactly 32 bytes (SHA-256 output).
		// Locate the inner OCTET STRING.
		return findInnerOctetString(new Uint8Array(inner), 32);
	}
	return null;
}

function findInnerOctetString(
	bytes: Uint8Array,
	expectedLength: number,
): Uint8Array | null {
	for (let i = 0; i < bytes.length - 1; i += 1) {
		// OCTET STRING tag is 0x04. Length encoding for 32 bytes is 0x20 (short).
		if (
			bytes[i] === 0x04 &&
			bytes[i + 1] === expectedLength &&
			i + 2 + expectedLength <= bytes.length
		) {
			return bytes.slice(i + 2, i + 2 + expectedLength);
		}
	}
	return null;
}

// ---- pkijs cert helpers -----------------------------------------------------

function exportSubjectPublicKey(cert: Certificate): Uint8Array {
	const spki = cert.subjectPublicKeyInfo.subjectPublicKey;
	return new Uint8Array(spki.valueBlock.valueHexView);
}

function parseRootCertFromPem(pem: string): Certificate {
	const stripped = pem
		.replace(/-----BEGIN CERTIFICATE-----/u, "")
		.replace(/-----END CERTIFICATE-----/u, "")
		.replace(/\s+/gu, "");
	const der = base64ToBytes(stripped);
	return Certificate.fromBER(toAlignedArrayBuffer(der));
}

// ---- ECDSA signature helpers ------------------------------------------------

function derEcdsaToRaw(der: Uint8Array, coordBytes: number): Uint8Array {
	if (der.length < 8 || der[0] !== 0x30) {
		throw new Error("ecdsa_der_not_sequence");
	}
	let offset = 2;
	if ((der[1] as number) & 0x80) {
		const lenBytes = (der[1] as number) & 0x7f;
		offset = 2 + lenBytes;
	}

	if (der[offset] !== 0x02) throw new Error("ecdsa_der_r_not_integer");
	const rLen = der[offset + 1] as number;
	const rStart = offset + 2;
	const r = der.slice(rStart, rStart + rLen);

	const sOffset = rStart + rLen;
	if (der[sOffset] !== 0x02) throw new Error("ecdsa_der_s_not_integer");
	const sLen = der[sOffset + 1] as number;
	const sStart = sOffset + 2;
	const s = der.slice(sStart, sStart + sLen);

	const out = new Uint8Array(coordBytes * 2);
	out.set(leftPadOrTrim(r, coordBytes), 0);
	out.set(leftPadOrTrim(s, coordBytes), coordBytes);
	return out;
}

function leftPadOrTrim(bytes: Uint8Array, targetLength: number): Uint8Array {
	if (bytes.length === targetLength) return bytes;
	if (bytes.length === targetLength + 1 && bytes[0] === 0x00) {
		return bytes.slice(1);
	}
	if (bytes.length < targetLength) {
		const out = new Uint8Array(targetLength);
		out.set(bytes, targetLength - bytes.length);
		return out;
	}
	throw new Error("ecdsa_integer_too_long");
}

// ---- byte helpers -----------------------------------------------------------

function utf8FixedLength(text: string, length: number): Uint8Array {
	const out = new Uint8Array(length);
	const encoded = new TextEncoder().encode(text);
	out.set(encoded.slice(0, length));
	return out;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
	const b0 = bytes[offset] as number;
	const b1 = bytes[offset + 1] as number;
	const b2 = bytes[offset + 2] as number;
	const b3 = bytes[offset + 3] as number;
	return b0 * 0x1_00_00_00 + ((b1 << 16) | (b2 << 8) | b3);
}

function concat(...parts: Uint8Array[]): Uint8Array {
	let total = 0;
	for (const part of parts) total += part.length;
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

function toAlignedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return buffer;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
	const buffer = await crypto.subtle.digest(
		"SHA-256",
		toAlignedArrayBuffer(bytes),
	);
	return new Uint8Array(buffer);
}

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/u, "");
}

function base64ToBytes(input: string): Uint8Array {
	const binary = atob(input);
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
	return out;
}
