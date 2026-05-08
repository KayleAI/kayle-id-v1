import { db } from "@kayle-id/database/drizzle";
import { mobile_attest_keys } from "@kayle-id/database/schema/core";
import { and, eq, sql } from "drizzle-orm";
import {
	type AppAttestEnvironment,
	computeAppAttestRpIdHash,
	verifyAssertion,
} from "./app-attest";
import {
	deriveAttestHelloChallenge,
	deriveAttestNfcChallenge,
} from "./attest-challenges";
import type { VerifyTransferState } from "./data-payload";

/**
 * App Attest gate logic. Sits between the wire decoders (hello / phase
 * messages) and the persistence layer. Each entry point:
 *
 *   1. Looks up the attested key in `mobile_attest_keys` by `key_id`.
 *   2. Computes `clientDataHash` from the server-canonical inputs (the
 *      assertion's `clientDataHash` is never trusted from the client).
 *   3. Calls `verifyAssertion` to check the ECDSA signature, rpIdHash, and
 *      counter monotonicity against the stored public key.
 *   4. Persists the new counter atomically — `UPDATE ... WHERE counter < $1`
 *      ensures concurrent attempts cannot lose updates and replays are
 *      rejected even across processes.
 *
 * Both entry points are pure with respect to the verify socket — they take
 * inputs and return outcomes; the caller decides how to surface failures.
 */

export type AttestGateOutcome =
	| { ok: true; counter: number }
	| {
			ok: false;
			code:
				| "HELLO_ATTEST_KEY_UNKNOWN"
				| "HELLO_ATTEST_INVALID"
				| "document_anti_cloning_attestation_failed";
			detail?: string;
	  };

export function isAttestationGateEnabled(env: CloudflareBindings): boolean {
	const flag =
		(env as { VERIFY_REQUIRE_ATTESTATION?: string })
			.VERIFY_REQUIRE_ATTESTATION ?? process.env.VERIFY_REQUIRE_ATTESTATION;
	return flag === "true";
}

export function resolveAppAttestEnvironment(
	env: CloudflareBindings,
): AppAttestEnvironment {
	return env.PUBLIC_AUTH_URL === "https://kayle.id"
		? "production"
		: "development";
}

export async function verifyHelloAttestation({
	attemptId,
	deviceId,
	appVersion,
	attestKeyId,
	helloAssertion,
	authSecret,
}: {
	attemptId: string;
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
		attemptId,
		authSecret,
	});

	const clientDataHash = await sha256(
		concat(
			textBytes("attest:hello:"),
			textBytes(attemptId),
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
		// A concurrent assertion advanced the counter past us. Treat as a
		// counter regression — replay protection wins atomically.
		return {
			ok: false,
			code: "HELLO_ATTEST_INVALID",
			detail: "counter_regressed_atomic",
		};
	}

	return { ok: true, counter: result.counter };
}

export async function verifyNfcAttestation({
	attemptId,
	attestKeyId,
	transfer,
	authSecret,
}: {
	attemptId: string;
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
		attemptId,
		authSecret,
	});

	const clientDataHash = await buildNfcClientDataHash({
		attemptId,
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

// ---- canonical NFC clientDataHash -----------------------------------------
//
// The exact byte order here is part of the wire contract — the iOS client
// must build clientDataHash from the same components in the same order, or
// every NFC assertion will fail. Both sides hash the same `attest:nfc:`
// label, attemptId, the SHA-256 of every uploaded artifact (or the SHA-256
// of an empty buffer when the artifact is absent), and the per-attempt
// challenge.

async function buildNfcClientDataHash({
	attemptId,
	challenge,
	transfer,
}: {
	attemptId: string;
	challenge: Uint8Array;
	transfer: VerifyTransferState;
}): Promise<Uint8Array> {
	const dg1Hash = await sha256(transfer.dg1 ?? new Uint8Array());
	const dg2Hash = await sha256(transfer.dg2 ?? new Uint8Array());
	const dg14Hash = await sha256(transfer.dg14 ?? new Uint8Array());
	const dg15Hash = await sha256(transfer.dg15 ?? new Uint8Array());
	const sodHash = await sha256(transfer.sod ?? new Uint8Array());
	const chipAuthHash = await sha256(
		transfer.chipAuthTranscript ?? new Uint8Array(),
	);
	const aaSignatureHash = await sha256(
		transfer.activeAuthSignature ?? new Uint8Array(),
	);

	return await sha256(
		concat(
			textBytes("attest:nfc:"),
			textBytes(attemptId),
			dg1Hash,
			dg2Hash,
			dg14Hash,
			dg15Hash,
			sodHash,
			chipAuthHash,
			aaSignatureHash,
			challenge,
		),
	);
}

// ---- DB helpers -----------------------------------------------------------

async function loadAttestKey(keyId: string): Promise<{
	publicKeyCose: Uint8Array;
	counter: number;
} | null> {
	const [row] = await db
		.select({
			publicKeyCose: mobile_attest_keys.publicKeyCose,
			counter: mobile_attest_keys.counter,
		})
		.from(mobile_attest_keys)
		.where(
			and(
				eq(mobile_attest_keys.keyId, keyId),
				eq(mobile_attest_keys.provider, "ios_app_attest"),
			),
		)
		.limit(1);

	if (!row?.publicKeyCose) {
		return null;
	}

	return {
		publicKeyCose: base64ToBytes(row.publicKeyCose),
		counter: row.counter,
	};
}

async function persistCounterIfHigher({
	keyId,
	newCounter,
	previousCounter,
}: {
	keyId: string;
	newCounter: number;
	previousCounter: number;
}): Promise<boolean> {
	const result = await db
		.update(mobile_attest_keys)
		.set({
			counter: newCounter,
			lastUsedAt: new Date(),
		})
		.where(
			and(
				eq(mobile_attest_keys.keyId, keyId),
				// Strictly less-than guard implements optimistic concurrency: if
				// another assertion advanced the counter past `previousCounter`
				// between our load and update, this update matches zero rows.
				sql`${mobile_attest_keys.counter} = ${previousCounter}`,
			),
		)
		.returning({ keyId: mobile_attest_keys.keyId });

	return result.length === 1;
}

// ---- byte helpers ---------------------------------------------------------

function textBytes(text: string): Uint8Array {
	return new TextEncoder().encode(text);
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

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
	const buffer = await crypto.subtle.digest(
		"SHA-256",
		toAlignedArrayBuffer(bytes),
	);
	return new Uint8Array(buffer);
}

function toAlignedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return buffer;
}

function base64ToBytes(input: string): Uint8Array {
	const binary = atob(input);
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		out[i] = binary.charCodeAt(i);
	}
	return out;
}
