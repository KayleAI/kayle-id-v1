import { expect, test } from "bun:test";
import { resolveHelloAuthState } from "@/v1/verify/hello-auth";
import {
	hashMobileDeviceId,
	hashMobileWriteToken,
} from "@/v1/verify/token-crypto";

function createSession(
	overrides: Partial<
		Parameters<typeof resolveHelloAuthState>[0]["session"]
	> = {},
): Parameters<typeof resolveHelloAuthState>[0]["session"] {
	return {
		currentPhase: "handoff",
		id: "va_test",
		mobileHelloDeviceIdHash: null,
		mobileWriteTokenConsumedAt: null,
		mobileWriteTokenExpiresAt: new Date(Date.now() + 60_000),
		mobileWriteTokenHash: null,
		status: "in_progress",
		...overrides,
	};
}

test("resolveHelloAuthState rejects an invalid mobile write token", async () => {
	const session = createSession({
		mobileWriteTokenHash: await hashMobileWriteToken("valid-token"),
	});

	const result = await resolveHelloAuthState({
		session,
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
	const session = createSession({
		mobileHelloDeviceIdHash: await hashMobileDeviceId(deviceId),
		mobileWriteTokenConsumedAt: new Date(),
		mobileWriteTokenHash: await hashMobileWriteToken("valid-token"),
	});

	const result = await resolveHelloAuthState({
		session,
		deviceId,
		mobileWriteToken: "valid-token",
		nowMs: Date.now(),
	});

	expect(result).toEqual({ kind: "resume" });
});

test("resolveHelloAuthState rejects a consumed token from a different device", async () => {
	const session = createSession({
		mobileHelloDeviceIdHash: await hashMobileDeviceId("device-a"),
		mobileWriteTokenConsumedAt: new Date(),
		mobileWriteTokenHash: await hashMobileWriteToken("valid-token"),
	});

	const result = await resolveHelloAuthState({
		session,
		deviceId: "device-b",
		mobileWriteToken: "valid-token",
		nowMs: Date.now(),
	});

	expect(result).toEqual({
		kind: "error",
		code: "HANDOFF_DEVICE_MISMATCH",
	});
});
