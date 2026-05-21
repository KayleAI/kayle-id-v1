import { verifyEcdsaActiveAuthentication } from "./active-auth-ecdsa";
import { failureResult, ICAO_CHALLENGE_BYTES } from "./active-auth-result";
import { verifyRsaActiveAuthentication } from "./active-auth-rsa";
import { type ActiveAuthEcdsaHashAlgorithm, parseDg14 } from "./dg14-parser";
import { type ParsedDg15, parseDg15 } from "./dg15-parser";
import { ensurePkijsEngine } from "./pkd-trust";
import { bufferBytes, bytesEqual } from "./sod-asn1-utils";
import type {
	ActiveAuthValidationResult,
	SupportedHashAlgorithm,
} from "./validation-types";

export { deriveActiveAuthChallenge } from "./active-auth-challenge";

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
