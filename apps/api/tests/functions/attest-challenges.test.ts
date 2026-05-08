import { describe, expect, test } from "bun:test";
import {
	deriveAttestHelloChallenge,
	deriveAttestNfcChallenge,
} from "@/v1/verify/attest-challenges";

const TEST_SECRET = "test-auth-secret-not-real";
const ATTEMPT_A = "va_test_attempt_a";
const ATTEMPT_B = "va_test_attempt_b";

describe("attest challenges", () => {
	test("deriveAttestHelloChallenge returns 32 bytes", async () => {
		const challenge = await deriveAttestHelloChallenge({
			attemptId: ATTEMPT_A,
			authSecret: TEST_SECRET,
		});

		expect(challenge.length).toBe(32);
	});

	test("deriveAttestNfcChallenge returns 32 bytes", async () => {
		const challenge = await deriveAttestNfcChallenge({
			attemptId: ATTEMPT_A,
			authSecret: TEST_SECRET,
		});

		expect(challenge.length).toBe(32);
	});

	test("hello challenge is deterministic for same attempt + secret", async () => {
		const first = await deriveAttestHelloChallenge({
			attemptId: ATTEMPT_A,
			authSecret: TEST_SECRET,
		});
		const second = await deriveAttestHelloChallenge({
			attemptId: ATTEMPT_A,
			authSecret: TEST_SECRET,
		});

		expect(toHex(first)).toBe(toHex(second));
	});

	test("hello challenge differs across attemptIds", async () => {
		const a = await deriveAttestHelloChallenge({
			attemptId: ATTEMPT_A,
			authSecret: TEST_SECRET,
		});
		const b = await deriveAttestHelloChallenge({
			attemptId: ATTEMPT_B,
			authSecret: TEST_SECRET,
		});

		expect(toHex(a)).not.toBe(toHex(b));
	});

	test("hello and nfc challenges differ for same attempt — distinct labels", async () => {
		// This is the load-bearing property: a hello assertion captured by an
		// attacker must not satisfy the NFC gate. Distinct labels in the HMAC
		// input enforce that.
		const hello = await deriveAttestHelloChallenge({
			attemptId: ATTEMPT_A,
			authSecret: TEST_SECRET,
		});
		const nfc = await deriveAttestNfcChallenge({
			attemptId: ATTEMPT_A,
			authSecret: TEST_SECRET,
		});

		expect(toHex(hello)).not.toBe(toHex(nfc));
	});

	test("challenges differ across secrets", async () => {
		const a = await deriveAttestHelloChallenge({
			attemptId: ATTEMPT_A,
			authSecret: TEST_SECRET,
		});
		const b = await deriveAttestHelloChallenge({
			attemptId: ATTEMPT_A,
			authSecret: `${TEST_SECRET}:rotated`,
		});

		expect(toHex(a)).not.toBe(toHex(b));
	});
});

function toHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}
