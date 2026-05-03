import { ObjectIdentifier } from "asn1js";
import { PublicKeyInfo } from "pkijs";
import { aesCmac, truncateMacToken } from "./aes-cmac";
import { deriveChipAuthKMac } from "./chip-auth-kdf";
import {
	type ChipAuthAlgorithm,
	chipAuthAlgorithmFromOid,
} from "./chip-auth-oids";
import {
	type ChipAuthTranscript,
	parseChipAuthTranscript,
} from "./chip-auth-transcript";
import {
	type ChipAuthInfoEntry,
	type ChipAuthPublicKeyInfoEntry,
	parseDg14,
} from "./dg14-parser";
import { ensurePkijsEngine } from "./pkd-trust";
import {
	bufferBytes,
	bytesEqual,
	concatUint8Arrays,
	exactBytes,
	parseBer,
} from "./sod-asn1-utils";
import { ECDSA_PUBLIC_KEY_OID } from "./sod-constants";
import type {
	ChipAuthFailureReason,
	ChipAuthValidationResult,
	SupportedHashAlgorithm,
} from "./validation-types";

const TR_03110_PUBLIC_KEY_TOKEN_TAG = Uint8Array.of(0x7f, 0x49);
const ECDH_POINT_TAG = 0x86;
const DH_VALUE_TAG = 0x84;
const UNCOMPRESSED_POINT_PREFIX = 0x04;

function failureResult(
	reason: ChipAuthFailureReason,
	detail: string | null = null,
): ChipAuthValidationResult {
	return {
		detail,
		ok: false,
		reason,
	};
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

function derEncodedOid(oid: string): Uint8Array {
	return new Uint8Array(new ObjectIdentifier({ value: oid }).toBER(false));
}

/**
 * Build the TR-03110-3 §A.2.1.2 "Authenticated Public Key" (tag '7F49')
 * over which the CA-v2 chip token T_PICC is computed.
 */
function encodeAuthenticatedPublicKey({
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

function selectChipAuthInfo(
	infos: ChipAuthInfoEntry[],
	oid: string,
	keyId: bigint | null,
): ChipAuthInfoEntry | null {
	const matches = infos.filter((info) => info.algorithm.oid === oid);

	if (matches.length === 0) {
		return null;
	}

	if (keyId !== null) {
		return matches.find((info) => info.keyId === keyId) ?? null;
	}

	if (matches.length === 1) {
		return matches[0] ?? null;
	}

	// Spec requires keyId when DG14 carries multiple CA infos.
	return matches.find((info) => info.keyId === null) ?? null;
}

function selectChipAuthPublicKey(
	keys: ChipAuthPublicKeyInfoEntry[],
	algorithm: ChipAuthAlgorithm,
	keyId: bigint | null,
): ChipAuthPublicKeyInfoEntry | null {
	const compatible = keys.filter(
		(entry) => entry.algorithmOid === algorithm.publicKeyOid,
	);

	if (compatible.length === 0) {
		return null;
	}

	if (keyId !== null) {
		return compatible.find((entry) => entry.keyId === keyId) ?? null;
	}

	if (compatible.length === 1) {
		return compatible[0] ?? null;
	}

	return compatible.find((entry) => entry.keyId === null) ?? null;
}

function parseChipPublicKeyInfo(bytes: Uint8Array): {
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

const NAMED_CURVE_BY_OID: Record<string, { name: string; coordBytes: number }> =
	{
		"1.2.840.10045.3.1.7": { coordBytes: 32, name: "P-256" },
		"1.3.132.0.34": { coordBytes: 48, name: "P-384" },
		"1.3.132.0.35": { coordBytes: 66, name: "P-521" },
	};

function namedCurveFromOid(
	oid: string | null,
): { name: string; coordBytes: number } | null {
	return oid ? (NAMED_CURVE_BY_OID[oid] ?? null) : null;
}

function chipUncompressedPoint(
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

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	const base64 = btoa(binary);
	return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

async function deriveEcdhSharedSecret({
	chipPoint,
	curveCoordBytes,
	curveName,
	terminalPoint,
	terminalScalar,
}: {
	chipPoint: Uint8Array;
	curveCoordBytes: number;
	curveName: string;
	terminalPoint: Uint8Array;
	terminalScalar: Uint8Array;
}): Promise<Uint8Array> {
	if (chipPoint.length !== 1 + 2 * curveCoordBytes) {
		throw new Error("chip_auth_chip_point_length_invalid");
	}

	if (terminalPoint.length !== 1 + 2 * curveCoordBytes) {
		throw new Error("chip_auth_terminal_point_length_invalid");
	}

	if (terminalScalar.length !== curveCoordBytes) {
		throw new Error("chip_auth_terminal_scalar_length_invalid");
	}

	const terminalX = terminalPoint.slice(1, 1 + curveCoordBytes);
	const terminalY = terminalPoint.slice(1 + curveCoordBytes);
	const chipX = chipPoint.slice(1, 1 + curveCoordBytes);
	const chipY = chipPoint.slice(1 + curveCoordBytes);

	const privateKey = await crypto.subtle.importKey(
		"jwk",
		{
			crv: curveName,
			d: bytesToBase64Url(terminalScalar),
			ext: true,
			key_ops: ["deriveBits"],
			kty: "EC",
			x: bytesToBase64Url(terminalX),
			y: bytesToBase64Url(terminalY),
		},
		{ name: "ECDH", namedCurve: curveName },
		false,
		["deriveBits"],
	);

	const publicKey = await crypto.subtle.importKey(
		"jwk",
		{
			crv: curveName,
			ext: true,
			kty: "EC",
			x: bytesToBase64Url(chipX),
			y: bytesToBase64Url(chipY),
		},
		{ name: "ECDH", namedCurve: curveName },
		false,
		[],
	);

	const bits = await crypto.subtle.deriveBits(
		// Workers' SubtleCrypto accepts both `public` (the WebCrypto spec name)
		// and `$public` (Workers-bound name to dodge the TS reserved word).
		{ $public: publicKey, name: "ECDH", public: publicKey } as never,
		privateKey,
		curveCoordBytes * 8,
	);

	return new Uint8Array(bits);
}

async function verifyEcdhChipAuthentication({
	algorithm,
	chipPublicKey,
	transcript,
}: {
	algorithm: ChipAuthAlgorithm;
	chipPublicKey: ChipAuthPublicKeyInfoEntry;
	transcript: ChipAuthTranscript;
}): Promise<ChipAuthValidationResult> {
	let parsedChipKey: ReturnType<typeof parseChipPublicKeyInfo>;

	try {
		parsedChipKey = parseChipPublicKeyInfo(
			chipPublicKey.subjectPublicKeyInfoBytes,
		);
	} catch {
		return failureResult("chip_public_key_invalid");
	}

	const namedCurve = namedCurveFromOid(parsedChipKey.namedCurveOid);

	if (!namedCurve) {
		return failureResult("chip_curve_unsupported");
	}

	const chipPoint = chipUncompressedPoint(parsedChipKey.publicKeyInfo);

	if (!chipPoint) {
		return failureResult("chip_public_key_invalid");
	}

	let sharedSecret: Uint8Array;

	try {
		sharedSecret = await deriveEcdhSharedSecret({
			chipPoint,
			curveCoordBytes: namedCurve.coordBytes,
			curveName: namedCurve.name,
			terminalPoint: transcript.terminalPublicKey,
			terminalScalar: transcript.terminalPrivateKey,
		});
	} catch (error) {
		return failureResult(
			"key_agreement_failed",
			error instanceof Error ? error.message : null,
		);
	}

	const kMac = await deriveChipAuthKMac({
		hash: algorithm.kdfHash,
		keyLength: algorithm.keyLength,
		nonce: transcript.chipNonce,
		sharedSecret,
	});

	const tokenInput = encodeAuthenticatedPublicKey({
		algorithmOid: algorithm.publicKeyOid,
		innerTag: ECDH_POINT_TAG,
		innerValue: transcript.terminalPublicKey,
	});

	if (algorithm.mac !== "AES-CMAC") {
		return failureResult("mac_algorithm_unsupported");
	}

	const expectedFullMac = await aesCmac({ key: kMac, message: tokenInput });
	const expectedToken = truncateMacToken(expectedFullMac);

	if (!bytesEqual(expectedToken, transcript.chipToken)) {
		return failureResult("chip_token_mismatch");
	}

	return {
		algorithm: algorithm.oid,
		keyAgreement: algorithm.keyAgreement,
		ok: true,
	};
}

export async function validateChipAuthentication({
	chipAuthData,
	dg14,
	sodAlgorithm,
	sodDg14Hash,
}: {
	chipAuthData: Uint8Array;
	dg14: Uint8Array;
	sodAlgorithm?: SupportedHashAlgorithm;
	sodDg14Hash?: Uint8Array;
}): Promise<ChipAuthValidationResult> {
	if (dg14.length === 0) {
		return failureResult("dg14_missing");
	}

	if (chipAuthData.length === 0) {
		return failureResult("transcript_missing");
	}

	if (sodAlgorithm && sodDg14Hash) {
		const dg14Digest = await crypto.subtle
			.digest(sodAlgorithm, bufferBytes(dg14))
			.then((buffer) => new Uint8Array(buffer));

		if (!bytesEqual(dg14Digest, sodDg14Hash)) {
			return failureResult("sod_dg14_hash_mismatch");
		}
	}

	ensurePkijsEngine();

	let transcript: ChipAuthTranscript;

	try {
		transcript = parseChipAuthTranscript(chipAuthData);
	} catch (error) {
		return failureResult(
			"transcript_parse_failed",
			error instanceof Error ? error.message : null,
		);
	}

	const algorithm = chipAuthAlgorithmFromOid(transcript.oid);

	if (!algorithm) {
		return failureResult("algorithm_unsupported", transcript.oid);
	}

	let parsed: ReturnType<typeof parseDg14>;

	try {
		parsed = parseDg14(dg14);
	} catch (error) {
		return failureResult(
			"dg14_parse_failed",
			error instanceof Error ? error.message : null,
		);
	}

	const info = selectChipAuthInfo(
		parsed.chipAuthInfos,
		algorithm.oid,
		transcript.keyId,
	);

	if (!info) {
		return failureResult("info_not_found");
	}

	const chipPublicKey = selectChipAuthPublicKey(
		parsed.chipAuthPublicKeys,
		algorithm,
		transcript.keyId,
	);

	if (!chipPublicKey) {
		return failureResult("chip_public_key_not_found");
	}

	if (algorithm.keyAgreement === "DH") {
		// DH is uncommon in modern passports and not yet wired through; the
		// existing EC code paths assume named curves supported by SubtleCrypto.
		return failureResult("dh_unsupported");
	}

	if (transcript.terminalPublicKey[0] !== UNCOMPRESSED_POINT_PREFIX) {
		return failureResult("terminal_public_key_invalid");
	}

	if (algorithm.mac !== "AES-CMAC") {
		return failureResult("mac_algorithm_unsupported");
	}

	return verifyEcdhChipAuthentication({
		algorithm,
		chipPublicKey,
		transcript,
	});
}

// Re-export the DH tag for any future code path that handles DH transcripts.
export const CHIP_AUTH_DH_VALUE_TAG = DH_VALUE_TAG;
