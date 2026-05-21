import { aesCmac, truncateMacToken } from "./aes-cmac";
import { deriveEcdhSharedSecret } from "./chip-auth-ecdh";
import { deriveChipAuthKMac } from "./chip-auth-kdf";
import type { ChipAuthAlgorithm } from "./chip-auth-oids";
import {
	chipUncompressedPoint,
	namedCurveFromOid,
	parseChipPublicKeyInfo,
} from "./chip-auth-public-key";
import { failureResult } from "./chip-auth-result";
import {
	ECDH_POINT_TAG,
	encodeAuthenticatedPublicKey,
} from "./chip-auth-token";
import type { ChipAuthTranscript } from "./chip-auth-transcript";
import type { ChipAuthPublicKeyInfoEntry } from "./dg14-parser";
import { bytesEqual } from "./sod-asn1-utils";
import type { ChipAuthValidationResult } from "./validation-types";

export async function verifyEcdhChipAuthentication({
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
