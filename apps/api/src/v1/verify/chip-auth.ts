import { verifyEcdhChipAuthentication } from "./chip-auth-ecdh-validation";
import { chipAuthAlgorithmFromOid } from "./chip-auth-oids";
import { UNCOMPRESSED_POINT_PREFIX } from "./chip-auth-public-key";
import { failureResult } from "./chip-auth-result";
import {
	selectChipAuthInfo,
	selectChipAuthPublicKey,
} from "./chip-auth-selection";
import { CHIP_AUTH_DH_VALUE_TAG } from "./chip-auth-token";
import {
	type ChipAuthTranscript,
	parseChipAuthTranscript,
} from "./chip-auth-transcript";
import { parseDg14 } from "./dg14-parser";
import { ensurePkijsEngine } from "./pkd-trust";
import { bufferBytes, bytesEqual } from "./sod-asn1-utils";
import type {
	ChipAuthValidationResult,
	SupportedHashAlgorithm,
} from "./validation-types";

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

export { CHIP_AUTH_DH_VALUE_TAG };
