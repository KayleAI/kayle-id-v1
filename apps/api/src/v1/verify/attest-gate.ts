import { computeAppAttestRpIdHash, verifyAssertion } from "./app-attest";
import {
	deriveAttestHelloChallenge,
	deriveAttestNfcChallenge,
} from "./attest-challenges";
import { concat, sha256, textBytes } from "./attest-gate-bytes";
import {
	isAttestationGateEnabled,
	resolveAppAttestEnvironment,
} from "./attest-gate-env";
import { buildNfcClientDataHash } from "./attest-gate-nfc-hash";
import {
	loadAttestKey,
	persistCounterIfHigher,
} from "./attest-gate-repository";
import type { AttestGateOutcome } from "./attest-gate-types";
import type { VerifyTransferState } from "./data-payload";

export type { AttestGateOutcome } from "./attest-gate-types";
export { isAttestationGateEnabled, resolveAppAttestEnvironment };

export async function verifyHelloAttestation({
	sessionId,
	deviceId,
	appVersion,
	attestKeyId,
	helloAssertion,
	authSecret,
}: {
	sessionId: string;
	deviceId: string;
	appVersion: string;
	attestKeyId: string;
	helloAssertion: Uint8Array;
	authSecret: string;
}): Promise<AttestGateOutcome> {
	const stored = await loadAttestKey(attestKeyId);
	if (!stored) {
		return { ok: false, code: "HELLO_ATTEST_KEY_UNKNOWN" };
	}

	const challenge = await deriveAttestHelloChallenge({
		sessionId,
		authSecret,
	});

	const clientDataHash = await sha256(
		concat(
			textBytes("attest:hello:"),
			textBytes(sessionId),
			textBytes(deviceId),
			textBytes(appVersion),
			challenge,
		),
	);

	const expectedRpIdHash = await computeAppAttestRpIdHash();

	const result = await verifyAssertion({
		assertionCbor: helloAssertion,
		clientDataHash,
		expectedRpIdHash,
		lastCounter: stored.counter,
		publicKeyCose: stored.publicKeyCose,
	});

	if (!result.ok) {
		return { ok: false, code: "HELLO_ATTEST_INVALID", detail: result.reason };
	}

	const persisted = await persistCounterIfHigher({
		keyId: attestKeyId,
		newCounter: result.counter,
		previousCounter: stored.counter,
	});

	if (!persisted) {
		return {
			ok: false,
			code: "HELLO_ATTEST_INVALID",
			detail: "counter_regressed_atomic",
		};
	}

	return { ok: true, counter: result.counter };
}

export async function verifyNfcAttestation({
	sessionId,
	attestKeyId,
	transfer,
	authSecret,
}: {
	sessionId: string;
	attestKeyId: string;
	transfer: VerifyTransferState;
	authSecret: string;
}): Promise<AttestGateOutcome> {
	const assertion = transfer.nfcAttestAssertion;
	if (!assertion || assertion.length === 0) {
		return {
			ok: false,
			code: "document_anti_cloning_attestation_failed",
			detail: "assertion_missing",
		};
	}

	const stored = await loadAttestKey(attestKeyId);
	if (!stored) {
		return {
			ok: false,
			code: "document_anti_cloning_attestation_failed",
			detail: "key_unknown",
		};
	}

	const challenge = await deriveAttestNfcChallenge({
		sessionId,
		authSecret,
	});

	const clientDataHash = await buildNfcClientDataHash({
		sessionId,
		challenge,
		transfer,
	});

	const expectedRpIdHash = await computeAppAttestRpIdHash();

	const result = await verifyAssertion({
		assertionCbor: assertion,
		clientDataHash,
		expectedRpIdHash,
		lastCounter: stored.counter,
		publicKeyCose: stored.publicKeyCose,
	});

	if (!result.ok) {
		return {
			ok: false,
			code: "document_anti_cloning_attestation_failed",
			detail: result.reason,
		};
	}

	const persisted = await persistCounterIfHigher({
		keyId: attestKeyId,
		newCounter: result.counter,
		previousCounter: stored.counter,
	});

	if (!persisted) {
		return {
			ok: false,
			code: "document_anti_cloning_attestation_failed",
			detail: "counter_regressed_atomic",
		};
	}

	return { ok: true, counter: result.counter };
}
