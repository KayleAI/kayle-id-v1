import {
	AUTH_DATA_AAGUID_OFFSET,
	AUTH_DATA_FLAGS_OFFSET,
	AUTH_DATA_RP_ID_HASH_OFFSET,
	readAuthDataCounter,
} from "./app-attest-auth-data";
import { bytesToBase64Url, concat, sha256 } from "./app-attest-bytes";
import { type AssertionCbor, decodeAssertionCbor } from "./app-attest-cbor";
import { parseCoseEc2Key } from "./app-attest-cose";
import { derEcdsaToRaw } from "./app-attest-ecdsa";
import type { AssertionVerificationResult } from "./app-attest-types";
import { bytesEqual } from "./sod-asn1-utils";

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

	const counter = readAuthDataCounter(decoded.authenticatorData);
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
