import { expect, test } from "bun:test";
import { resolveHelloAuthState } from "@/v1/verify/hello-auth";
import {
	hashMobileDeviceId,
	hashMobileWriteToken,
} from "@/v1/verify/token-crypto";

function createAttempt(
	overrides: Partial<
		Parameters<typeof resolveHelloAuthState>[0]["attempt"]
	> = {},
): Parameters<typeof resolveHelloAuthState>[0]["attempt"] {
	return {
		currentPhase: "handoff",
		id: "va_test",
		mobileHelloDeviceIdHash: null,
		mobileWriteTokenConsumedAt: null,
		mobileWriteTokenExpiresAt: new Date(Date.now() + 60_000),
		mobileWriteTokenHash: null,
		status: "pending",
		...overrides,
	};
}

test("resolveHelloAuthState rejects an invalid mobile write token", async () => {
	const attempt = createAttempt({
		mobileWriteTokenHash: await hashMobileWriteToken("valid-token"),
	});

	const result = await resolveHelloAuthState({
		attempt,
		deviceId: "device-a",
		mobileWriteToken: "wrong-token",
		nowMs: Date.now(),
	});

	expect(result).toEqual({
		kind: "error",
		code: "HANDOFF_TOKEN_INVALID",
	});
});

test("resolveHelloAuthState resumes a consumed token from the same device", async () => {
	const deviceId = "device-a";
	const attempt = createAttempt({
		mobileHelloDeviceIdHash: await hashMobileDeviceId(deviceId),
		mobileWriteTokenConsumedAt: new Date(),
		mobileWriteTokenHash: await hashMobileWriteToken("valid-token"),
	});

	const result = await resolveHelloAuthState({
		attempt,
		deviceId,
		mobileWriteToken: "valid-token",
		nowMs: Date.now(),
	});

	expect(result).toEqual({ kind: "resume" });
});

test("resolveHelloAuthState rejects a consumed token from a different device", async () => {
	const attempt = createAttempt({
		mobileHelloDeviceIdHash: await hashMobileDeviceId("device-a"),
		mobileWriteTokenConsumedAt: new Date(),
		mobileWriteTokenHash: await hashMobileWriteToken("valid-token"),
	});

	const result = await resolveHelloAuthState({
		attempt,
		deviceId: "device-b",
		mobileWriteToken: "valid-token",
		nowMs: Date.now(),
	});

	expect(result).toEqual({
		kind: "error",
		code: "HANDOFF_DEVICE_MISMATCH",
	});
});
