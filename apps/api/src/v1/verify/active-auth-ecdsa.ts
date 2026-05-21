import type { AaHashAlgorithm } from "./active-auth-hash";
import { failureResult } from "./active-auth-result";
import type { ActiveAuthEcdsaHashAlgorithm } from "./dg14-parser";
import type { ParsedDg15 } from "./dg15-parser";
import { bufferBytes, exactBytes } from "./sod-asn1-utils";
import type { ActiveAuthValidationResult } from "./validation-types";

const ECDSA_HASH_FALLBACKS: AaHashAlgorithm[] = [
	"SHA-256",
	"SHA-1",
	"SHA-512",
	"SHA-384",
	"SHA-224",
];

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

export async function verifyEcdsaActiveAuthentication({
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
