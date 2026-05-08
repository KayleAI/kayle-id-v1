import { bufferBytes } from "./sod-asn1-utils";

const ATTEST_HELLO_LABEL = "attest:hello:";
const ATTEST_NFC_LABEL = "attest:nfc:";
const ATTEST_CHALLENGE_BYTES = 32;

async function deriveAttestChallenge(
	label: string,
	keyMaterial: string,
	authSecret: string,
): Promise<Uint8Array> {
	const secretBytes = new TextEncoder().encode(authSecret);
	const payloadBytes = new TextEncoder().encode(`${label}${keyMaterial}`);

	const key = await crypto.subtle.importKey(
		"raw",
		bufferBytes(secretBytes),
		{ hash: "SHA-256", name: "HMAC" },
		false,
		["sign"],
	);

	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		bufferBytes(payloadBytes),
	);

	return new Uint8Array(signature).slice(0, ATTEST_CHALLENGE_BYTES);
}

/**
 * Per-attempt challenge bound into the hello assertion's `clientDataHash`. The
 * iOS client signs over this nonce together with attempt/device metadata so the
 * server cryptographically witnesses the attempt anchor. Deterministic from
 * `attemptId` so it survives WebSocket reconnects without shared state, but
 * unpredictable to anyone without `AUTH_SECRET`.
 */
export function deriveAttestHelloChallenge({
	attemptId,
	authSecret,
}: {
	attemptId: string;
	authSecret: string;
}): Promise<Uint8Array> {
	return deriveAttestChallenge(ATTEST_HELLO_LABEL, attemptId, authSecret);
}

/**
 * Per-attempt challenge bound into the NFC-completion assertion. Distinct
 * label from the hello challenge so a hello assertion can never be replayed
 * to satisfy the NFC gate.
 */
export function deriveAttestNfcChallenge({
	attemptId,
	authSecret,
}: {
	attemptId: string;
	authSecret: string;
}): Promise<Uint8Array> {
	return deriveAttestChallenge(ATTEST_NFC_LABEL, attemptId, authSecret);
}
