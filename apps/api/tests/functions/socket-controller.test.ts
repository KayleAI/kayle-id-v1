import { afterEach, expect, test } from "bun:test";
import { shouldEnableVerifySocketDebug } from "@/v1/verify/socket-controller";

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
	if (typeof originalNodeEnv === "string") {
		process.env.NODE_ENV = originalNodeEnv;
		return;
	}

	delete process.env.NODE_ENV;
});

test("verify socket debug mode is disabled in production", () => {
	process.env.NODE_ENV = "production";

	expect(shouldEnableVerifySocketDebug(true)).toBeFalse();
});

test("verify socket debug mode requires an explicit non-production request", () => {
	process.env.NODE_ENV = "test";

	expect(shouldEnableVerifySocketDebug(false)).toBeFalse();
	expect(shouldEnableVerifySocketDebug(true)).toBeTrue();
});
